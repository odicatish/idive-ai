// app/api/export/status/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPORT_BUCKET = "exports";

type ExportRow = {
  id: string;
  user_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  error: string | null;
  presenter: any;
  prompt: string | null;
  file_path: string | null;
  file_url?: string | null;
  created_at: string;
  updated_at: string;
};

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const cookieStore = await cookies();
  const url = new URL(req.url);
  const jobId = (url.searchParams.get("jobId") || "").trim();

  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set() {},
        remove() {},
      },
    }
  );

  // auth
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth?.user) {
    return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
  }
  const userId = auth.user.id;

  // read job (user client; RLS + filter)
  const { data, error } = await supabase
    .from("exports")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  let job = data as ExportRow;

  // If job needs processing, do the real work now (idempotent-ish)
  const needsWork =
    (job.status === "queued" || job.status === "processing") && !job.file_path && job.error == null;

  if (needsWork) {
    // mark processing (best-effort)
    await supabaseAdmin
      .from("exports")
      .update({ status: "processing", progress: 20, error: null })
      .eq("id", job.id)
      .eq("user_id", userId);

    try {
      const presenter = job.presenter ?? {};
      const presenterId = typeof presenter?.id === "string" ? presenter.id : null;

      // load latest script (source of truth)
      let scriptContent: string | null = null;
      if (presenterId) {
        const { data: scriptRow } = await supabaseAdmin
          .from("presenter_scripts")
          .select("content")
          .eq("presenter_id", presenterId)
          .maybeSingle();

        scriptContent = (scriptRow?.content ?? null) as any;
      }

      // build package
      const exportPackage = {
        exported_at: new Date().toISOString(),
        user_id: userId,
        job_id: job.id,
        prompt: job.prompt ?? null,
        presenter: {
          ...presenter,
          id: presenterId,
          // prefer latest script from presenter_scripts
          script: scriptContent ?? presenter?.script ?? null,
        },
      };

      await supabaseAdmin
        .from("exports")
        .update({ progress: 55 })
        .eq("id", job.id)
        .eq("user_id", userId);

      const filePath = `${userId}/${presenterId ?? "no-presenter"}/${job.id}/export-${Date.now()}.json`;
      const bytes = Buffer.from(JSON.stringify(exportPackage, null, 2), "utf8");

      const uploadRes = await supabaseAdmin.storage.from(EXPORT_BUCKET).upload(filePath, bytes, {
        contentType: "application/json",
        upsert: true,
      });

      if (uploadRes.error) {
        await supabaseAdmin
          .from("exports")
          .update({ status: "failed", progress: 100, error: uploadRes.error.message })
          .eq("id", job.id)
          .eq("user_id", userId);

        return NextResponse.json(
          { status: "failed", progress: 100, error: uploadRes.error.message, downloadUrl: null },
          { status: 200 }
        );
      }

      // store file_path; keep file_url optional (signed url is short-lived anyway)
      await supabaseAdmin
        .from("exports")
        .update({ status: "completed", progress: 100, file_path: filePath, error: null })
        .eq("id", job.id)
        .eq("user_id", userId);

      // reload
      const { data: refreshed } = await supabaseAdmin
        .from("exports")
        .select("*")
        .eq("id", job.id)
        .eq("user_id", userId)
        .single();

      job = refreshed as ExportRow;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      await supabaseAdmin
        .from("exports")
        .update({ status: "failed", progress: 100, error: msg })
        .eq("id", job.id)
        .eq("user_id", userId);

      return NextResponse.json(
        { status: "failed", progress: 100, error: msg, downloadUrl: null },
        { status: 200 }
      );
    }
  }

  // return signed download URL if completed
  let downloadUrl: string | null = null;
  if (job.status === "completed" && job.file_path) {
    const signed = await supabaseAdmin.storage.from(EXPORT_BUCKET).createSignedUrl(job.file_path, 60 * 10);
    if (!signed.error) downloadUrl = signed.data.signedUrl;
  }

  return NextResponse.json(
    {
      status: job.status,
      progress: job.progress ?? 0,
      error: job.error ?? null,
      downloadUrl,
    },
    { status: 200 }
  );
}