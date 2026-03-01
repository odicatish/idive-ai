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

function getOrigin(req: Request) {
  try {
    const url = new URL(req.url);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

export async function GET(req: Request) {
  // Debug-friendly endpoint. Browser navigation is GET, so we return instructions.
  const origin = getOrigin(req);
  return NextResponse.json(
    {
      ok: true,
      route: "/api/video-jobs/run-worker",
      message:
        "Use POST to run one worker tick (server-side call to /api/video-worker with secret).",
      howToTest: origin
        ? {
            curl: `curl -X POST "${origin}/api/video-jobs/run-worker" -H "Content-Type: application/json"`,
          }
        : { curl: `curl -X POST "/api/video-jobs/run-worker"` },
      note:
        "POST requires you to be logged in (uses your Supabase session cookie). If not authenticated it returns 401.",
    },
    { status: 200 }
  );
}

export async function POST(req: Request) {
  try {
    const supabase = await getSupabase();

    // Must be a logged-in user (session cookie)
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth?.user) {
      return NextResponse.json({ ok: false, error: "NOT_AUTHENTICATED" }, { status: 401 });
    }

    const secret = (process.env.VIDEO_WORKER_SECRET || "").trim();
    if (!secret) {
      return NextResponse.json(
        { ok: false, error: "Missing VIDEO_WORKER_SECRET" },
        { status: 500 }
      );
    }

    // Run worker on the same deploy, server-side (we do NOT expose secret to client)
    const origin = getOrigin(req);
    if (!origin) {
      return NextResponse.json({ ok: false, error: "Could not resolve origin" }, { status: 500 });
    }

    const r = await fetch(`${origin}/api/video-worker?secret=${encodeURIComponent(secret)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    const txt = await r.text().catch(() => "");

    // Always return 200 so UI can handle it easily; include worker status inside payload
    return NextResponse.json(
      {
        ok: true,
        status: r.status,
        body: txt ? safeJson(txt) : null,
      },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("RUN_WORKER_ERROR", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unknown_error" },
      { status: 500 }
    );
  }
}