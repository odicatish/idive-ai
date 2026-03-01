// app/api/video-jobs/run-worker/route.ts
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

function safeJson(txt: string) {
  try {
    return JSON.parse(txt);
  } catch {
    return txt;
  }
}

export async function GET(req: Request) {
  // GET = debug/health (browser-friendly). Nu rulează worker.
  const hasSecret = !!process.env.VIDEO_WORKER_SECRET;
  return NextResponse.json({
    ok: true,
    route: "/api/video-jobs/run-worker",
    methods: ["POST"],
    hasWorkerSecret: hasSecret,
    message:
      "Use POST to run one queued video job server-side (requires auth). GET is only a health/debug response.",
  });
}

export async function POST(req: Request) {
  try {
    const supabase = await getSupabase();

    // Auth required (ca să nu poată oricine să-ți ruleze worker-ul)
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth?.user) {
      return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
    }

    const secret = (process.env.VIDEO_WORKER_SECRET || "").trim();
    if (!secret) {
      return NextResponse.json({ error: "Missing VIDEO_WORKER_SECRET" }, { status: 500 });
    }

    // Rulează worker-ul pe același origin, dar server-side (nu expui secret în client)
    const url = new URL(req.url);
    const origin = `${url.protocol}//${url.host}`;

    const r = await fetch(`${origin}/api/video-worker?secret=${encodeURIComponent(secret)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const txt = await r.text().catch(() => "");
    return NextResponse.json(
      { ok: r.ok, status: r.status, body: txt ? safeJson(txt) : null },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown_error" }, { status: 500 });
  }
}