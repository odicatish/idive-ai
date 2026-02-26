// app/api/video-worker/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";

function jsonError(status: number, error: string, details?: any) {
  return NextResponse.json({ ok: false, error, ...(details ? { details } : {}) }, { status });
}

function timingSafeEqual(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function getBearer(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || "";
}

function getSecret(req: Request) {
  // 1) Authorization: Bearer xxx  (Vercel Cron va trimite asta automat dacă ai CRON_SECRET)
  const bearer = getBearer(req);

  // 2) x-video-worker-secret: xxx (fallback)
  const headerAlt = (req.headers.get("x-video-worker-secret") || "").trim();

  // 3) ?secret=xxx (fallback)
  let qp = "";
  try {
    const url = new URL(req.url);
    qp = (url.searchParams.get("secret") || "").trim();
  } catch {}

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

export async function GET() {
  // În browser vei vedea asta (nu 404)
  return NextResponse.json(
    { ok: false, error: "method_not_allowed", message: "Use POST. Called by Vercel Cron." },
    { status: 405 }
  );
}

export async function POST(req: Request) {
  try {
    // ✅ Folosește CRON_SECRET (mecanismul Vercel)
    // (fallback la VIDEO_WORKER_SECRET pentru test/manual)
    const expected = process.env.CRON_SECRET || process.env.VIDEO_WORKER_SECRET || "";
    if (!expected) return jsonError(500, "missing_cron_secret_env");

    const secret = getSecret(req);
    if (!secret || !timingSafeEqual(secret, expected)) {
      return jsonError(401, "unauthorized_worker");
    }

    const supabase = supabaseAdmin();

    // pick 1 queued job
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

    // move to processing
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

    // mock pipeline
    await new Promise((r) => setTimeout(r, 600));
    await supabase.from("presenter_video_jobs").update({ progress: 25, updated_at: new Date().toISOString() }).eq("id", job.id);

    await new Promise((r) => setTimeout(r, 600));
    await supabase.from("presenter_video_jobs").update({ progress: 55, updated_at: new Date().toISOString() }).eq("id", job.id);

    await new Promise((r) => setTimeout(r, 600));
    await supabase.from("presenter_video_jobs").update({ progress: 85, updated_at: new Date().toISOString() }).eq("id", job.id);

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
  } catch (e: any) {
    console.error("VIDEO_WORKER_ERROR", e);
    return jsonError(500, "internal_error", e?.message ?? String(e));
  }
}