// app/api/video-worker/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { generateVoiceoverForJob } from "../../../lib/video/generateVoiceover";
import { renderMp4ForJob } from "../../../lib/video/renderMp4";

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
    };
  }

  const client = createClient(usedUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return { ok: true as const, client };
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
    .select("id")
    .eq("legacy_job_id", legacyJob.id)
    .maybeSingle();

  if (fetchErr) throw new Error(`pipeline_fetch_failed: ${fetchErr.message}`);
  if (!pipelineJob?.id) throw new Error("pipeline_job_missing_after_upsert");

  try {
    await supabase.rpc("seed_video_render_steps", { p_job_id: pipelineJob.id });
  } catch {}

  return pipelineJob.id as string;
}

async function getFreshSignedAudioUrl(supabase: any, pipelineJobId: string) {
  const { data: asset, error } = await supabase
    .from("video_assets")
    .select("storage_bucket,storage_path,public_url")
    .eq("job_id", pipelineJobId)
    .eq("asset_type", "audio_voice")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !asset) return { ok: false as const, audioUrl: null as string | null };

  if (asset.storage_bucket && asset.storage_path) {
    const { data: signed, error: sErr } = await supabase.storage
      .from(asset.storage_bucket)
      .createSignedUrl(asset.storage_path, 60 * 60);

    if (!sErr && signed?.signedUrl) {
      return { ok: true as const, audioUrl: signed.signedUrl as string };
    }
  }

  return { ok: true as const, audioUrl: (asset.public_url ?? null) as string | null };
}

async function legacyHasMp4Asset(supabase: any, pipelineJobId: string) {
  const { data } = await supabase
    .from("video_assets")
    .select("id")
    .eq("job_id", pipelineJobId)
    .eq("asset_type", "video_mp4")
    .eq("status", "completed")
    .limit(1);

  return Array.isArray(data) && data.length > 0;
}

function getErrorMessage(e: any) {
  return typeof e?.message === "string" && e.message.trim()
    ? e.message.trim()
    : String(e ?? "unknown_error");
}

async function updatePipelineJob(
  supabase: any,
  pipelineJobId: string,
  patch: Record<string, any>
) {
  try {
    await supabase
      .from("video_render_jobs")
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pipelineJobId);
  } catch {}
}

async function updateLegacyJob(
  supabase: any,
  legacyJobId: string,
  patch: Record<string, any>
) {
  await supabase
    .from("presenter_video_jobs")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", legacyJobId);
}

async function ensureVoiceoverExists(supabase: any, pipelineJobId: string) {
  const existing = await getFreshSignedAudioUrl(supabase, pipelineJobId);
  if (existing.ok && existing.audioUrl) return existing.audioUrl;

  await generateVoiceoverForJob(pipelineJobId);

  const after = await getFreshSignedAudioUrl(supabase, pipelineJobId);
  if (!after.ok || !after.audioUrl) {
    throw new Error("voiceover_missing_after_generation");
  }

  return after.audioUrl;
}

async function mp4OnlyForLegacyJob(supabase: any, legacyJob: any) {
  const pipelineJobId = await ensurePipelineJobForLegacyJob(supabase, legacyJob);

  const already = await legacyHasMp4Asset(supabase, pipelineJobId);
  if (already) {
    return { didWork: false as const, reason: "mp4_already_exists", pipelineJobId };
  }

  await updatePipelineJob(supabase, pipelineJobId, {
    status: "processing",
    progress: 65,
    error: null,
  });

  await ensureVoiceoverExists(supabase, pipelineJobId);

  let mp4Url: string | null = null;

  try {
    mp4Url = await renderMp4ForJob(pipelineJobId);
    if (!mp4Url) throw new Error("mp4_url_missing_after_render");
  } catch (e: any) {
    const message = getErrorMessage(e);

    await updatePipelineJob(supabase, pipelineJobId, {
      status: "failed",
      error: message,
    });

    return {
      didWork: false as const,
      reason: "mp4_render_failed",
      pipelineJobId,
      error: message,
    };
  }

  await updateLegacyJob(supabase, legacyJob.id, {
    provider: "ffmpeg-worker",
    provider_job_id: pipelineJobId,
    video_url: mp4Url,
  });

  await updatePipelineJob(supabase, pipelineJobId, {
    status: "completed",
    progress: 100,
    video_url: mp4Url,
    error: null,
  });

  return { didWork: true as const, pipelineJobId, mp4Url };
}

async function processLegacyJobQueued(supabase: any, legacyJobId: string) {
  const { data: job, error: fetchErr } = await supabase
    .from("presenter_video_jobs")
    .select("*")
    .eq("id", legacyJobId)
    .maybeSingle();

  if (fetchErr) throw new Error(`legacy_fetch_failed: ${fetchErr.message}`);
  if (!job) throw new Error("legacy_job_not_found");

  const nowIso = new Date().toISOString();
  const { data: locked, error: lockErr } = await supabase
    .from("presenter_video_jobs")
    .update({
      status: "processing",
      progress: 5,
      error: null,
      updated_at: nowIso,
    })
    .eq("id", legacyJobId)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();

  if (lockErr) throw new Error(`legacy_lock_failed: ${lockErr.message}`);
  if (!locked) return { didWork: false as const, reason: "legacy_not_queued_anymore" };

  const pipelineJobId = await ensurePipelineJobForLegacyJob(supabase, locked);

  try {
    await updatePipelineJob(supabase, pipelineJobId, {
      status: "processing",
      progress: 10,
      error: null,
    });

    await updateLegacyJob(supabase, legacyJobId, {
      status: "processing",
      progress: 25,
      error: null,
    });

    await ensureVoiceoverExists(supabase, pipelineJobId);

    await updatePipelineJob(supabase, pipelineJobId, {
      status: "processing",
      progress: 60,
      error: null,
    });

    await updateLegacyJob(supabase, legacyJobId, {
      status: "processing",
      progress: 70,
      error: null,
    });

    const mp4Url = await renderMp4ForJob(pipelineJobId);
    if (!mp4Url) throw new Error("mp4_url_missing_after_render");

    await updateLegacyJob(supabase, legacyJobId, {
      status: "completed",
      progress: 100,
      provider: "ffmpeg-worker",
      provider_job_id: pipelineJobId,
      video_url: mp4Url,
      error: null,
    });

    await updatePipelineJob(supabase, pipelineJobId, {
      status: "completed",
      progress: 100,
      video_url: mp4Url,
      error: null,
    });

    return {
      didWork: true as const,
      legacyJobId,
      pipelineJobId,
      mp4Url,
    };
  } catch (e: any) {
    const message = getErrorMessage(e);

    await updateLegacyJob(supabase, legacyJobId, {
      status: "failed",
      progress: 100,
      provider: "ffmpeg-worker",
      provider_job_id: pipelineJobId,
      video_url: null,
      error: message,
    });

    await updatePipelineJob(supabase, pipelineJobId, {
      status: "failed",
      progress: 100,
      video_url: null,
      error: message,
    });

    throw new Error(`queued_render_failed: ${message}`);
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
    message:
      "POST will process ONE queued legacy job. If none queued, it will try to render MP4 for latest completed job.",
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

    let jobId = "";
    try {
      const url = new URL(req.url);
      jobId = (url.searchParams.get("jobId") || "").trim();
    } catch {}

    if (jobId) {
      const { data: legacy, error } = await supabase
        .from("presenter_video_jobs")
        .select("*")
        .eq("id", jobId)
        .maybeSingle();

      if (error) return jsonError(500, "legacy_fetch_failed", error.message);
      if (!legacy) return jsonError(404, "legacy_job_not_found");

      if (legacy.status === "queued") {
        const out = await processLegacyJobQueued(supabase, jobId);
        return NextResponse.json({ ok: true, ...out, ran: "queued_by_jobId" });
      }

      const out = await mp4OnlyForLegacyJob(supabase, legacy);
      return NextResponse.json({
        ok: true,
        ...out,
        legacyJobId: jobId,
        ran: "mp4_only_by_jobId",
      });
    }

    const { data: queued, error: pickErr } = await supabase
      .from("presenter_video_jobs")
      .select("id")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (pickErr) return jsonError(500, "job_pick_failed", pickErr.message);

    if (queued?.id) {
      const out = await processLegacyJobQueued(supabase, queued.id);
      return NextResponse.json({ ok: true, ...out, ran: "queued_next" });
    }

    const { data: latest, error: lErr } = await supabase
      .from("presenter_video_jobs")
      .select("*")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lErr) return jsonError(500, "latest_completed_fetch_failed", lErr.message);
    if (!latest) {
      return NextResponse.json({
        ok: true,
        didWork: false,
        message: "No queued jobs and no completed jobs.",
      });
    }

    const out = await mp4OnlyForLegacyJob(supabase, latest);
    return NextResponse.json({
      ok: true,
      ...out,
      legacyJobId: latest.id,
      ran: "mp4_only_latest_completed",
    });
  } catch (e: any) {
    console.error("VIDEO_WORKER_ERROR", e);
    return jsonError(500, "internal_error", e?.message ?? String(e));
  }
}