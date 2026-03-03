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
      const host = u.hostname;
      return host.split(".")[0] || null;
    } catch {
      return null;
    }
  })();

  return { ok: true as const, client, usedUrl, projectRef };
}

// ---- pipeline helpers ----

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
    .select("id, legacy_job_id")
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

async function pickPipelineJobForVoiceover(supabase: any) {
  const { data: voiceRows, error: vErr } = await supabase
    .from("video_render_steps")
    .select("job_id")
    .eq("step", "voiceover")
    .eq("status", "queued")
    .limit(25);

  if (vErr) throw new Error(`pick_voiceover_steps_failed: ${vErr.message}`);
  if (!voiceRows || voiceRows.length === 0) return null;

  for (const row of voiceRows) {
    const { data: sb, error: sbErr } = await supabase
      .from("video_render_steps")
      .select("status")
      .eq("job_id", row.job_id)
      .eq("step", "storyboard")
      .maybeSingle();

    if (sbErr) continue;
    if (sb?.status === "completed") return row.job_id as string;
  }

  return null;
}

async function syncLegacyProgressFromPipeline(supabase: any, pipelineJobId: string, patch: any) {
  const { data: pj } = await supabase
    .from("video_render_jobs")
    .select("legacy_job_id")
    .eq("id", pipelineJobId)
    .maybeSingle();

  const legacyJobId = pj?.legacy_job_id;
  if (!legacyJobId) return;

  await supabase
    .from("presenter_video_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", legacyJobId);
}

async function runPipelineVoiceoverIfAny(supabase: any) {
  const jobId = await pickPipelineJobForVoiceover(supabase);
  if (!jobId) return null;

  const nowIso = new Date().toISOString();

  // lock step
  const { data: lockedStep, error: lockErr } = await supabase
    .from("video_render_steps")
    .update({
      status: "processing",
      progress: 5,
      started_at: nowIso,
      updated_at: nowIso,
      error_message: null,
    })
    .eq("job_id", jobId)
    .eq("step", "voiceover")
    .eq("status", "queued")
    .select("job_id, step, status")
    .maybeSingle();

  if (lockErr) throw new Error(`voiceover_lock_failed: ${lockErr.message}`);
  if (!lockedStep) return null;

  // reflect in legacy UI immediately
  await syncLegacyProgressFromPipeline(supabase, jobId, {
    status: "processing",
    progress: 15,
    provider: "openai-tts",
    error: null,
  });

  try {
    await generateVoiceoverForJob(jobId);

    await supabase
      .from("video_render_steps")
      .update({
        status: "completed",
        progress: 100,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("job_id", jobId)
      .eq("step", "voiceover");

    await supabase
      .from("video_render_jobs")
      .update({ progress: 30, updated_at: new Date().toISOString() })
      .eq("id", jobId);

    // legacy progress moves too (UI now updates)
    await syncLegacyProgressFromPipeline(supabase, jobId, {
      status: "processing",
      progress: 30,
      provider: "openai-tts",
    });

    return jobId;
  } catch (e: any) {
    const msg = e?.message ?? String(e);

    await supabase
      .from("video_render_steps")
      .update({
        status: "failed",
        error_message: msg,
        updated_at: new Date().toISOString(),
      })
      .eq("job_id", jobId)
      .eq("step", "voiceover");

    await syncLegacyProgressFromPipeline(supabase, jobId, {
      status: "failed",
      error: `voiceover_error: ${msg}`,
    });

    throw e;
  }
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
    message: "POST will process pipeline voiceover OR one queued legacy job (requires secret).",
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

    // 0) PIPELINE-FIRST voiceover
    const pipelineJobId = await runPipelineVoiceoverIfAny(supabase);
    if (pipelineJobId) {
      return NextResponse.json({
        ok: true,
        didWork: true,
        ran: "pipeline_voiceover",
        pipelineJobId,
        debug: { usedUrl, projectRef },
      });
    }

    // 1) fallback: take one legacy queued job and ensure pipeline exists
    const { data: job } = await supabase
      .from("presenter_video_jobs")
      .select("*")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!job) {
      return NextResponse.json({
        ok: true,
        didWork: false,
        message: "No queued jobs.",
        debug: { usedUrl, projectRef },
      });
    }

    // lock legacy
    const nowIso = new Date().toISOString();
    const { data: locked } = await supabase
      .from("presenter_video_jobs")
      .update({ status: "processing", progress: 5, error: null, updated_at: nowIso })
      .eq("id", job.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();

    if (!locked) {
      return NextResponse.json({
        ok: true,
        didWork: false,
        message: "Legacy job already taken by another run.",
        debug: { usedUrl, projectRef },
      });
    }

    // ensure pipeline now
    const createdPipelineId = await ensurePipelineJobForLegacyJob(supabase, job);

    return NextResponse.json({
      ok: true,
      didWork: true,
      ran: "legacy_link_pipeline",
      legacyJobId: job.id,
      pipelineJobId: createdPipelineId,
      debug: { usedUrl, projectRef },
    });
  } catch (e: any) {
    console.error("VIDEO_WORKER_ERROR", e);
    return jsonError(500, "internal_error", e?.message ?? String(e));
  }
}