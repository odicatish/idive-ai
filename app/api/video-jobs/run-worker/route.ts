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
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

async function runWorker(req: Request) {
  const supabase = await getSupabase();

  // must be logged in (so random people can't hit this endpoint)
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth?.user) {
    return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
  }

  const secret = (process.env.VIDEO_WORKER_SECRET || "").trim();
  if (!secret) {
    return NextResponse.json({ error: "Missing VIDEO_WORKER_SECRET" }, { status: 500 });
  }

  // call /api/video-worker server-side (secret not exposed to client)
  const origin = getOrigin(req);

  const r = await fetch(`${origin}/api/video-worker?secret=${encodeURIComponent(secret)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  const txt = await r.text().catch(() => "");
  return NextResponse.json(
    { ok: r.ok, status: r.status, body: txt ? safeJson(txt) : null },
    { status: 200 }
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run");

  // default: just info (browser friendly)
  if (run !== "1") {
    return NextResponse.json({
      ok: true,
      route: "/api/video-jobs/run-worker",
      methods: ["GET", "POST"],
      message:
        "Use POST to run worker. For quick browser test: add ?run=1 (requires login).",
      example: {
        browser: "/api/video-jobs/run-worker?run=1",
        curl: `curl -X POST "${url.origin}/api/video-jobs/run-worker"`,
      },
    });
  }

  // GET ?run=1 => execute
  return runWorker(req);
}

export async function POST(req: Request) {
  return runWorker(req);
}