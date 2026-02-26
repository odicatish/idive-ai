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
    const presenterId = String(body.presenterId || "").trim();

    if (!presenterId) {
      return NextResponse.json({ error: "Missing presenterId" }, { status: 400 });
    }

    const { data: job, error } = await supabase
      .from("presenter_video_jobs")
      .insert({
        user_id: auth.user.id,
        presenter_id: presenterId,
        status: "queued",
        progress: 0,
        error: null,
        video_url: null,
        provider: null,
        provider_job_id: null,
      })
      .select("id,status,progress")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 🔥 Trigger worker imediat (ca să nu aștepți cron-ul daily)
    // IMPORTANT: pune VIDEO_WORKER_SECRET în Vercel env.
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://idive-ai.vercel.app").replace(/\/$/, "");
    const workerSecret = process.env.VIDEO_WORKER_SECRET;

    if (workerSecret) {
      // fire-and-forget
      fetch(`${appUrl}/api/video-worker?secret=${encodeURIComponent(workerSecret)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true, job }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown_error" }, { status: 500 });
  }
}