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

async function runWorker(req: Request, jobId?: string) {
  const supabase = await getSupabase();

  // must be logged in
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth?.user) {
    return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
  }

  const secret = (process.env.VIDEO_WORKER_SECRET || "").trim();
  if (!secret) {
    return NextResponse.json({ error: "Missing VIDEO_WORKER_SECRET" }, { status: 500 });
  }

  const origin = getOrigin(req);

  const url =
    `${origin}/api/video-worker?secret=${encodeURIComponent(secret)}` +
    (jobId ? `&jobId=${encodeURIComponent(jobId)}` : "");

  const r = await fetch(url, { method: "POST" });
  const txt = await r.text().catch(() => "");

  return NextResponse.json(
    {
      ok: true,
      called: url.replace(secret, "***"),
      workerStatus: r.status,
      workerResponse: txt ? safeJson(txt) : null,
    },
    { status: 200 }
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run");

  if (run !== "1") {
    return NextResponse.json({
      ok: true,
      route: "/api/video-jobs/run-worker",
      methods: ["GET", "POST"],
      message: "Use POST with {jobId} to run worker for that job. GET ?run=1 runs without jobId (next queued).",
      example: {
        browser: "/api/video-jobs/run-worker?run=1",
        post: { jobId: "UUID_HERE" },
      },
    });
  }

  return runWorker(req);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";
  return runWorker(req, jobId || undefined);
}