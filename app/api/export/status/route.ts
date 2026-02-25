// app/api/export/status/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportRow = {
  id: string;
  user_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  error: string | null;
  presenter: any;
  prompt: string | null;
  file_path: string | null;
  created_at: string;
  updated_at: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export async function GET(req: Request) {
  const cookieStore = await cookies();
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");

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

  // read job (RLS ensures user sees only own, but we also filter)
  const { data, error } = await supabase
    .from("exports")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  let job = data as ExportRow;

  // If queued/processing => simulate progress based on time since created_at
  if (job.status === "queued" || job.status === "processing") {
    const createdMs = new Date(job.created_at).getTime();
    const nowMs = Date.now();
    const elapsed = nowMs - createdMs;

    // ~12s to finish (tweak how you like)
    const pct = clamp(Math.floor((elapsed / 12000) * 100), 0, 100);

    // move to processing early
    const nextStatus: ExportRow["status"] = pct >= 100 ? "completed" : "processing";

    // update progress/status using service role (since RLS blocks updates)
    await supabaseAdmin
      .from("exports")
      .update({ status: nextStatus, progress: pct })
      .eq("id", job.id)
      .eq("user_id", userId);

    // reload job from admin to get latest fields
    const { data: refreshed } = await supabaseAdmin
      .from("exports")
      .select("*")
      .eq("id", job.id)
      .eq("user_id", userId)
      .single();

    job = refreshed as ExportRow;

    // on completion, upload “artifact” once
    if (job.status === "completed" && !job.file_path) {
      const filePath = `${userId}/${job.id}/export-${Date.now()}.json`;

      const exportPackage = {
        exported_at: new Date().toISOString(),
        user_id: userId,
        job_id: job.id,
        prompt: job.prompt ?? null,
        presenter: job.presenter,
      };

      const bytes = Buffer.from(JSON.stringify(exportPackage, null, 2), "utf8");

      const uploadRes = await supabaseAdmin.storage
        .from("exports")
        .upload(filePath, bytes, {
          contentType: "application/json",
          upsert: true,
        });

      if (uploadRes.error) {
        await supabaseAdmin
          .from("exports")
          .update({ status: "failed", error: uploadRes.error.message })
          .eq("id", job.id)
          .eq("user_id", userId);

        return NextResponse.json(
          { status: "failed", progress: job.progress, error: uploadRes.error.message },
          { status: 200 }
        );
      }

      await supabaseAdmin
        .from("exports")
        .update({ file_path: filePath })
        .eq("id", job.id)
        .eq("user_id", userId);

      // reload
      const { data: refreshed2 } = await supabaseAdmin
        .from("exports")
        .select("*")
        .eq("id", job.id)
        .eq("user_id", userId)
        .single();

      job = refreshed2 as ExportRow;
    }
  }

  // If completed, return a signed download URL (short-lived)
  let downloadUrl: string | null = null;
  if (job.status === "completed" && job.file_path) {
    const signed = await supabaseAdmin.storage
      .from("exports")
      .createSignedUrl(job.file_path, 60 * 10); // 10 min

    if (!signed.error) downloadUrl = signed.data.signedUrl;
  }

  return NextResponse.json(
    {
      status: job.status,
      progress: job.progress,
      error: job.error,
      downloadUrl,
    },
    { status: 200 }
  );
}
