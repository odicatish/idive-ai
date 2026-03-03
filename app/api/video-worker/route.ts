// app/api/video-worker/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { generateVoiceoverForJob } from "../../../lib/video/generateVoiceover";

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

function getExpectedSecret() {
  return (process.env.VIDEO_WORKER_SECRET || "").trim();
}

function supabaseAdminSafe() {
  const usedUrl =
    (process.env.SUPABASE_URL || "").trim() ||
    (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!usedUrl || !serviceKey) {
    return {
      ok: false as const,
      error: "missing_supabase_env",
      details: {
        has_SUPABASE_URL: !!(process.env.SUPABASE_URL || "").trim(),
        has_NEXT_PUBLIC_SUPABASE_URL: !!(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim(),
        has_SUPABASE_SERVICE_ROLE_KEY: !!(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
      },
      client: null as any,
      usedUrl,
      projectRef: null as string | null,
    };
  }

  const client = createClient(usedUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const projectRef = (() => {
    try {
      const u = new URL(usedUrl);
      return u.hostname.split(".")[0] || null;
    } catch {
      return null;
    }
  })();

  return { ok: true as const, client, usedUrl, projectRef };
}

async function ensurePipelineJobForLegacyJob(supabase: any, legacyJob: any) {
  const nowIso = new Date().toISOString();

  const payload = {
    legacy_job_id: legacyJob.id,
    presenter_id: legacyJob.presenter_id,
    script_id: legacyJob.script_id,
    script_version: legacyJob.script_version,
    user_id: legacyJob.created_by,
    status: "processing",
    progress: legacyJob.progress ?? 0,
    updated_at: nowIso,
  };

  const { error: upsertErr } = await supabase
    .from("video_render_jobs")
    .upsert(payload, { onConflict: "legacy_job_id" });

  if (upsertErr) throw new Error(`pipeline_upsert_failed: ${upsertErr.message}`);

  const { data: pipelineJob, error: fetchErr } = await supabase
    .from("video_render_jobs")
    .select("id,legacy_job_id")
    .eq("legacy_job_id", legacyJob.id)
    .maybeSingle();

  if (fetchErr) throw new Error(`pipeline_fetch_failed: ${fetchErr.message}`);
  if (!pipelineJob?.id) throw new Error("pipeline_job_missing_after_upsert");

  // seed steps (best-effort)
  try {
    await supabase.rpc("seed_video_render_steps", { p_job_id: pipelineJob.id });
  } catch {}

  return pipelineJob.id as string;
}

/**
 * TEMP MVP:
 * Ca să nu ne blocăm în storyboard acum, îl marcăm completed automat
 * (doar pentru a putea rula voiceover și să vezi progres + fișier în storage).
 */
async function forceStoryboardCompleted(supabase: any, pipelineJobId: string) {
  const nowIso = new Date().toISOString();

  // dacă există storyboard step și nu e completed, îl completăm
  await supabase
    .from("video_render_steps")
    .update({
      status: "completed",
      progress: 100,
      started_at: nowIso,
      completed_at: nowIso,
      updated_at: nowIso,
      error_message: null,
    })
    .eq("job_id", pipelineJobId)
    .eq("step", "storyboard")
    .neq("status", "completed");
}

async function setLegacyProgress(supabase: any, legacyJobId: string, patch: any) {
  await supabase
    .from("presenter_video_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", legacyJobId);
}

async function getVoiceAssetUrl(supabase: any, pipelineJobId: string) {
  const { data } = await supabase
    .from("video_assets")
    .select("public_url,storage_bucket,storage_path,created_at")
    .eq("job_id", pipelineJobId)
    .eq("asset_type", "audio_voice")
    .order("created_at", { ascending: false })
    .limit(1);

  const row = data?.[0];
  return row?.public_url || null;
}

export async function GET(req: Request) {
  const secret = getSecret(req);
  const expected = getExpectedSecret();
  const sb = supabaseAdminSafe();

  return NextResponse.json({
    ok: true,
    route: "/api/video-worker",
    hasSecret: !!secret,
    secretConfigured: !!expected,
    secretMatches: !!expected && !!secret && timingSafeEqual(secret, expected),
    supabaseEnvOk: sb.ok,
    message: "POST will process ONE queued legacy job (requires secret).",
  });
}

export async function POST(req: Request) {
  try {
    const secret = getSecret(req);
    const expected = getExpectedSecret();

    if (!expected) return jsonError(500, "worker_secret_missing", "Set VIDEO_WORKER_SECRET in env.");
    if (!secret || !timingSafeEqual(secret, expected)) return jsonError(401, "unauthorized_worker");

    const sb = supabaseAdminSafe();
    if (!sb.ok) return jsonError(500, sb.error, sb.details);

    const supabase = sb.client;
    const usedUrl = sb.usedUrl;
    const projectRef = sb.projectRef;

    // 1) pick next queued legacy job
    const { data: job, error: pickErr } = await supabase
      .from("presenter_video_jobs")
      .select("*")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (pickErr) return jsonError(500, "job_pick_failed", { message: pickErr.message, usedUrl, projectRef });

    if (!job) {
      return NextResponse.json({
        ok: true,
        didWork: false,
        message: "No queued jobs.",
        debug: { usedUrl, projectRef },
      });
    }

    // 2) lock legacy job
    const nowIso = new Date().toISOString();
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
      .select("id")
      .maybeSingle();

    if (lockErr) return jsonError(500, "job_lock_failed", { message: lockErr.message, usedUrl, projectRef });
    if (!locked) {
      return NextResponse.json({
        ok: true,
        didWork: false,
        message: "Job already taken by another run.",
        debug: { usedUrl, projectRef },
      });
    }

    // 3) ensure pipeline job exists
    const pipelineJobId = await ensurePipelineJobForLegacyJob(supabase, job);

    // 4) TEMP: force storyboard completed so voiceover can run
    await forceStoryboardCompleted(supabase, pipelineJobId);

    // 5) progress bump so UI moves
    await setLegacyProgress(supabase, job.id, {
      status: "processing",
      progress: 15,
      provider: "openai-tts",
      provider_job_id: pipelineJobId,
    });

    // 6) run voiceover (this uploads mp3 + creates video_assets row)
    await generateVoiceoverForJob(pipelineJobId);

    await setLegacyProgress(supabase, job.id, {
      status: "processing",
      progress: 60,
      provider: "openai-tts",
      provider_job_id: pipelineJobId,
    });

    // 7) attach "Open video" link (for now: mp3 signed url)
    const voiceUrl = await getVoiceAssetUrl(supabase, pipelineJobId);

    await setLegacyProgress(supabase, job.id, {
      status: "completed",
      progress: 100,
      provider: "openai-tts",
      provider_job_id: pipelineJobId,
      video_url: voiceUrl, // TEMP: link to voiceover file
    });

    return NextResponse.json({
      ok: true,
      didWork: true,
      ran: "legacy_voiceover_mvp",
      legacyJobId: job.id,
      pipelineJobId,
      voiceUrl,
      debug: { usedUrl, projectRef },
    });
  } catch (e: any) {
    console.error("VIDEO_WORKER_ERROR", e);
    return jsonError(500, "internal_error", e?.message ?? String(e));
  }
}