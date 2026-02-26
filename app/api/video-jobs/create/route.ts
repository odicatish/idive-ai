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

    const presenterId = (body?.presenterId ?? body?.presenter_id ?? "").toString().trim();
    const scriptId = (body?.scriptId ?? body?.script_id ?? "").toString().trim();
    const scriptVersionRaw = body?.scriptVersion ?? body?.script_version ?? 1;
    const scriptVersion = Number(scriptVersionRaw);

    if (!presenterId) return NextResponse.json({ error: "Missing presenterId" }, { status: 400 });
    if (!scriptId) return NextResponse.json({ error: "Missing scriptId" }, { status: 400 });
    if (!Number.isFinite(scriptVersion) || scriptVersion < 1) {
      return NextResponse.json({ error: "Invalid scriptVersion" }, { status: 400 });
    }

    const now = new Date().toISOString();

    const { data: job, error } = await supabase
      .from("presenter_video_jobs")
      .insert({
        presenter_id: presenterId,
        script_id: scriptId,
        script_version: scriptVersion,
        created_by: auth.user.id,
        status: "queued",
        progress: 0,
        error: null,
        created_at: now,
        updated_at: now,
      })
      .select("id,status,progress,created_at,updated_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, job }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown_error" }, { status: 500 });
  }
}