// app/api/video-jobs/create/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSupabase() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set() {},
      remove() {},
    },
  });
}

export async function POST(req: Request) {
  try {
    const supabase = await getSupabase();

    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth?.user) {
      return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const presenterId = String(body?.presenterId || body?.presenter_id || "").trim();
    if (!presenterId) {
      return NextResponse.json({ error: "Missing presenterId" }, { status: 400 });
    }

    // 0) owner check (defense-in-depth)
    const { data: presenter, error: pErr } = await supabase
      .from("presenters")
      .select("id,user_id")
      .eq("id", presenterId)
      .maybeSingle();

    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
    if (!presenter || presenter.user_id !== auth.user.id) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    // 1) load current script for presenter
    const { data: scriptRow, error: scriptErr } = await supabase
      .from("presenter_scripts")
      .select("id, version")
      .eq("presenter_id", presenterId)
      .maybeSingle();

    if (scriptErr) return NextResponse.json({ error: scriptErr.message }, { status: 500 });
    if (!scriptRow?.id) {
      return NextResponse.json(
        { error: "No script found for presenter. Generate script first." },
        { status: 400 }
      );
    }

    const scriptId = scriptRow.id as string;
    const scriptVersion = (scriptRow.version ?? 1) as number;

    // 2) create job
    const { data: job, error: jobErr } = await supabase
      .from("presenter_video_jobs")
      .insert({
        presenter_id: presenterId,
        script_id: scriptId,
        script_version: scriptVersion,
        status: "queued",
        progress: 0,
        created_by: auth.user.id,
      })
      .select("id,status,progress,created_at")
      .single();

    if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, job }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown_error" }, { status: 500 });
  }
}