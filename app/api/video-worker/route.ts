// app/api/video-worker/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(status: number, error: string, details?: any) {
  return NextResponse.json({ ok: false, error, ...(details ? { details } : {}) }, { status });
}

function timingSafeEqual(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function getSecret(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const bearer = m?.[1]?.trim();

  const headerAlt = (req.headers.get("x-video-worker-secret") || "").trim();

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

function getExpectedSecret() {
  // IMPORTANT: în prod, set VIDEO_WORKER_SECRET obligatoriu.
  // Dacă nu e setat, refuzăm request-ul (mai sigur decât un default hardcodat).
  const expected = (process.env.VIDEO_WORKER_SECRET || "").trim();
  return expected;
}

export async function GET(req: Request) {
  // GET = healthcheck public (NU cere secret)
  const secret = getSecret(req);
  const expected = getExpectedSecret();

  return NextResponse.json({
    ok: true,
    route: "/api/video-worker",
    hasSecret: !!secret,
    secretConfigured: !!expected,
    secretMatches: !!expected && !!secret && timingSafeEqual(secret, expected),
    message: "POST will process one queued job (requires secret).",
  });
}

export async function POST(req: Request) {
  try {
    const secret = getSecret(req);
    const expected = getExpectedSecret();

    if (!expected) {
      return jsonError(500, "worker_secret_missing", "Set VIDEO_WORKER_SECRET in env.");
    }

    if (!secret || !timingSafeEqual(secret, expected)) {
      return jsonError(401, "unauthorized_worker");
    }

    const supabase = supabaseAdmin();

    // 1) pick next queued job
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

    const nowIso = new Date().toISOString();

    // 2) atomic lock: update only if still queued
    const { data: locked, error: lockErr } = await supabase
      .from("presenter_video_jobs")
      .update({
        status: "processing",
        progress: 5,
        error: null,
        updated_at: nowIso,
      })
      .eq("id", job.id)
      .eq("status", "queued")
      .select("id,status,progress,presenter_id")
      .maybeSingle();

    if (lockErr) return jsonError(500, "job_lock_failed", lockErr.message);

    // if someone else already took it
    if (!locked) {
      return NextResponse.json({
        ok: true,
        didWork: false,
        message: "Job was already taken by another worker run.",
      });
    }

    // mock pipeline (best-effort progress updates)
    await new Promise((r) => setTimeout(r, 400));
    await supabase
      .from("presenter_video_jobs")
      .update({ progress: 25, updated_at: new Date().toISOString() })
      .eq("id", job.id);

    await new Promise((r) => setTimeout(r, 400));
    await supabase
      .from("presenter_video_jobs")
      .update({ progress: 55, updated_at: new Date().toISOString() })
      .eq("id", job.id);

    await new Promise((r) => setTimeout(r, 400));
    await supabase
      .from("presenter_video_jobs")
      .update({ progress: 85, updated_at: new Date().toISOString() })
      .eq("id", job.id);

    await new Promise((r) => setTimeout(r, 400));

    const fakeUrl = `https://example.com/videos/${job.presenter_id}/${job.id}.mp4`;

    // 3) complete
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