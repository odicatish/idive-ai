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
    };
  }

  const client = createClient(usedUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return { ok: true as const, client };
}

function extractSignedUrl(vo: any): string | null {
  if (!vo) return null;
  if (typeof vo === "string") return vo;
  if (typeof vo?.signedUrl === "string") return vo.signedUrl;
  if (typeof vo?.voiceUrl === "string") return vo.voiceUrl;
  if (typeof vo?.url === "string") return vo.url;
  return null;
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

  // seed steps (best-effort)
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

  // Prefer fresh signed URL (public_url may expire)
  if (asset.storage_bucket && asset.storage_path) {
    const { data: signed, error: sErr } = await supabase.storage
      .from(asset.storage_bucket)
      .createSignedUrl(asset.storage_path, 60 * 60);

    if (!sErr && signed?.signedUrl) {
      return { ok: true as const, audioUrl: signed.signedUrl as string };
    }
  }

  // fallback (maybe still valid)
  return { ok: true as const, audioUrl: (asset.public_url ?? null) as string | null };
}

async function renderMp4ViaRailway(pipelineJobId: string, audioUrl: string) {
  const base = (process.env.VIDEO_RENDERER_URL || "").trim();
  const secret = (process.env.VIDEO_RENDERER_SECRET || "").trim();
  if (!base || !secret) {
    return { ok: false as const, reason: "missing_VIDEO_RENDERER_URL_or_SECRET" };
  }

  const endpoint = `${base.replace(/\/$/, "")}/render-mp4`;

  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      jobId: pipelineJobId,
      audioUrl,
      output: { bucket: "renders", path: `videos/${pipelineJobId}.mp4` },
    }),
  });

  const txt = await r.text().catch(() => "");
  let json: any = null;
  try {
    json = txt ? JSON.parse(txt) : null;
  } catch {
    json = { raw: txt };
  }

  if (!r.ok) {
    return { ok: false as const, reason: "railway_render_failed", status: r.status, response: json };
  }

  return { ok: true as const, mp4Url: json?.mp4Url ?? null, response: json };
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

async function mp4OnlyForLegacyJob(supabase: any, legacyJob: any) {
  const pipelineJobId = await ensurePipelineJobForLegacyJob(supabase, legacyJob);

  // if already has mp4, don't redo
  const already = await legacyHasMp4Asset(supabase, pipelineJobId);
  if (already) {
    return { didWork: false as const, reason: "mp4_already_exists", pipelineJobId };
  }

  // we need an audioUrl (voiceover)
  let audio = await getFreshSignedAudioUrl(supabase, pipelineJobId);

  // if missing audio, generate it now
  if (!audio.ok || !audio.audioUrl) {
    const vo = await generateVoiceoverForJob(pipelineJobId);
    const signedUrl = extractSignedUrl(vo);
    if (!signedUrl) throw new Error("voiceover_missing_and_could_not_generate");
    audio = { ok: true as const, audioUrl: signedUrl };
  }

  const mp4 = await renderMp4ViaRailway(pipelineJobId, audio.audioUrl!);
  if (!mp4.ok) {
    return { didWork: false as const, reason: "mp4_render_failed", pipelineJobId, mp4Debug: mp4 };
  }

  const mp4Url = mp4.mp4Url ?? null;

  // update legacy job to point to mp4
  await supabase
    .from("presenter_video_jobs")
    .update({
      video_url: mp4Url ?? legacyJob.video_url,
      provider: "ffmpeg-worker",
      provider_job_id: pipelineJobId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", legacyJob.id);

  // update pipeline job too (best-effort)
  try {
    await supabase
      .from("video_render_jobs")
      .update({ video_url: mp4Url, updated_at: new Date().toISOString() })
      .eq("id", pipelineJobId);
  } catch {}

  return { didWork: true as const, pipelineJobId, mp4Url, mp4Debug: mp4 };
}

async function processLegacyJobQueued(supabase: any, legacyJobId: string) {
  const { data: job, error: fetchErr } = await supabase
    .from("presenter_video_jobs")
    .select("*")
    .eq("id", legacyJobId)
    .maybeSingle();

  if (fetchErr) throw new Error(`legacy_fetch_failed: ${fetchErr.message}`);
  if (!job) throw new Error("legacy_job_not_found");

  // lock only if queued
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

  // Create pipeline + voiceover
  const pipelineJobId = await ensurePipelineJobForLegacyJob(supabase, locked);
  const vo = await generateVoiceoverForJob(pipelineJobId);
  const signedUrl = extractSignedUrl(vo);

  // Try mp4
  let mp4Url: string | null = null;
  let mp4Debug: any = null;
  if (signedUrl) {
    const mp4 = await renderMp4ViaRailway(pipelineJobId, signedUrl);
    mp4Debug = mp4;
    if (mp4.ok && mp4.mp4Url) mp4Url = mp4.mp4Url;
  }

  // finalize legacy
  await supabase
    .from("presenter_video_jobs")
    .update({
      status: "completed",
      progress: 100,
      provider: mp4Url ? "ffmpeg-worker" : "openai-tts-mvp",
      provider_job_id: pipelineJobId,
      video_url: mp4Url ?? signedUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", legacyJobId);

  return {
    didWork: true as const,
    legacyJobId,
    pipelineJobId,
    voiceUrl: signedUrl,
    mp4Url,
    mp4Debug,
  };
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

    // jobId optional (?jobId=uuid) — legacy presenter_video_jobs.id
    let jobId = "";
    try {
      const url = new URL(req.url);
      jobId = (url.searchParams.get("jobId") || "").trim();
    } catch {}

    if (jobId) {
      // If queued -> normal flow, else -> mp4-only upgrade
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

      // status completed/processing -> try mp4 only
      const out = await mp4OnlyForLegacyJob(supabase, legacy);
      return NextResponse.json({ ok: true, ...out, legacyJobId: jobId, ran: "mp4_only_by_jobId" });
    }

    // 1) try next queued
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

    // 2) no queued -> pick latest completed legacy and try mp4-only
    const { data: latest, error: lErr } = await supabase
      .from("presenter_video_jobs")
      .select("*")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lErr) return jsonError(500, "latest_completed_fetch_failed", lErr.message);
    if (!latest) return NextResponse.json({ ok: true, didWork: false, message: "No queued jobs and no completed jobs." });

    const out = await mp4OnlyForLegacyJob(supabase, latest);
    return NextResponse.json({ ok: true, ...out, legacyJobId: latest.id, ran: "mp4_only_latest_completed" });
  } catch (e: any) {
    console.error("VIDEO_WORKER_ERROR", e);
    return jsonError(500, "internal_error", e?.message ?? String(e));
  }
}