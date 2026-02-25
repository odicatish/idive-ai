// app/api/video-worker/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";

function jsonError(status: number, error: string, details?: any) {
  return NextResponse.json({ error, ...(details ? { details } : {}) }, { status });
}

function timingSafeEqual(a: string, b: string) {
  // avoid throw on different lengths
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function getSecret(req: Request) {
  // 1) Authorization: Bearer xxx
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const bearer = (m?.[1] || "").trim();

  // 2) x-video-worker-secret: xxx
  const headerAlt = (req.headers.get("x-video-worker-secret") || "").trim();

  // 3) ?secret=xxx
  let qp = "";
  try {
    const url = new URL(req.url);
    qp = (url.searchParams.get("secret") || "").trim();
  } catch {
    // ignore
  }

  return bearer || headerAlt || qp || "";
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function handle(req: Request) {
  // 1) worker secret
  const secret = getSecret(req);
  const expected = process.env.VIDEO_WORKER_SECRET || "dev_secret_123";

  if (!secret || !timingSafeEqual(secret, expected)) {
    return jsonError(401, "unauthorized_worker");
  }

  // 2) admin client
  const supabase = supabaseAdmin();

  // 3) pick 1 queued job
  const { data: job, error: pickErr } = await supabase
    .from("presenter_video_jobs")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (pickErr) return jsonError(500, "job_pick_failed", pickErr.message);

  if (!job) {
    return NextResponse.json({ ok: true, didWork: false, message: "No queued jobs." });
  }

  // 4) move to processing
  const { error: lockErr } = await supabase
    .from("presenter_video_jobs")
    .update({
      status: "processing",
      progress: 5,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  if (lockErr) return jsonError(500, "job_lock_failed", lockErr.message);

  // 5) simulate render pipeline (mock)
  await new Promise((r) => setTimeout(r, 600));
  await supabase
    .from("presenter_video_jobs")
    .update({ progress: 25, updated_at: new Date().toISOString() })
    .eq("id", job.id);

  await new Promise((r) => setTimeout(r, 600));
  await supabase
    .from("presenter_video_jobs")
    .update({ progress: 55, updated_at: new Date().toISOString() })
    .eq("id", job.id);

  await new Promise((r) => setTimeout(r, 600));
  await supabase
    .from("presenter_video_jobs")
    .update({ progress: 85, updated_at: new Date().toISOString() })
    .eq("id", job.id);

  await new Promise((r) => setTimeout(r, 600));

  const fakeUrl = `https://example.com/videos/${job.presenter_id}/${job.id}.mp4`;

  const { error: doneErr } = await supabase
    .from("presenter_video_jobs")
    .update({
      status: "completed",
      progress: 100,
      video_url: fakeUrl,
      provider: "mock",
      provider_job_id: String(job.id),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  if (doneErr) return jsonError(500, "job_complete_failed", doneErr.message);

  return NextResponse.json({
    ok: true,
    didWork: true,
    job: { id: job.id, status: "completed", progress: 100, videoUrl: fakeUrl },
  });
}

export async function GET(req: Request) {
  // Vercel Cron hits GET. We support GET for cron.
  const secret = getSecret(req);
  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error: "missing_secret",
        message:
          "Call with ?secret=... or Authorization: Bearer ... (Cron uses GET by default).",
      },
      { status: 400 }
    );
  }

  try {
    return await handle(req);
  } catch (e: any) {
    console.error("VIDEO_WORKER_ERROR", e);
    return jsonError(500, "internal_error", e?.message ?? String(e));
  }
}

export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (e: any) {
    console.error("VIDEO_WORKER_ERROR", e);
    return jsonError(500, "internal_error", e?.message ?? String(e));
  }
}