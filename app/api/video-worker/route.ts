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

// acceptă orice formă de return de la generateVoiceoverForJob
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

/**
 * ✅ RENDER MP4 via Railway worker
 * Trimite audioUrl (signed mp3) și jobId (pipeline job id),
 * worker-ul upload-ează mp4 în Storage și inserează video_assets(video_mp4).
 */
async function renderMp4ViaRailway(pipelineJobId: string, audioUrl: string) {
  const base = (process.env.VIDEO_RENDERER_URL || "").trim();
  const secret = (process.env.VIDEO_RENDERER_SECRET || "").trim();
  if (!base || !secret) {
    // dacă lipsește, nu stricăm flow-ul — rămâne mp3
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

/**
 * MVP FINALIZER:
 * - după voiceover, marcăm pipeline ca completed și restul steps ca skipped
 * - astfel /video-status + UI nu mai rămân blocate la 17% / queued
 */
async function finalizePipelineAsVoiceoverOnly(
  supabase: any,
  pipelineJobId: string,
  signedUrl: string | null,
  preferredVideoUrl?: string | null
) {
  const now = new Date().toISOString();

  // 1) mark remaining steps skipped (best-effort)
  try {
    await supabase
      .from("video_render_steps")
      .update({
        status: "skipped",
        progress: 0,
        completed_at: now,
        updated_at: now,
      })
      .eq("job_id", pipelineJobId)
      .in("step", ["storyboard", "scene_generation", "captions", "composition", "export"])
      .eq("status", "queued");
  } catch {}

  // 2) mark pipeline job completed
  try {
    await supabase
      .from("video_render_jobs")
      .update({
        status: "completed",
        progress: 100,
        // dacă avem mp4, îl preferăm
        video_url: preferredVideoUrl ?? signedUrl,
        updated_at: now,
      })
      .eq("id", pipelineJobId);
  } catch {}
}

async function processLegacyJob(supabase: any, legacyJobId: string) {
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

  // link pipeline job + generate voiceover
  const pipelineJobId = await ensurePipelineJobForLegacyJob(supabase, locked);

  const vo = await generateVoiceoverForJob(pipelineJobId);
  const signedUrl = extractSignedUrl(vo);

  // ✅ nou: după ce avem mp3, încercăm să randăm mp4 pe Railway
  let mp4Url: string | null = null;
  let mp4Debug: any = null;
  if (signedUrl) {
    const mp4 = await renderMp4ViaRailway(pipelineJobId, signedUrl);
    mp4Debug = mp4;
    if (mp4.ok && mp4.mp4Url) mp4Url = mp4.mp4Url;
  }

  // ✅ finalize pipeline so UI doesn't stick at 17%
  await finalizePipelineAsVoiceoverOnly(supabase, pipelineJobId, signedUrl, mp4Url);

  // ✅ important pentru UI: setăm progress + video_url pe legacy (preferăm mp4 dacă există)
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
    message: "POST will process ONE queued legacy job (or a specific jobId) — requires secret.",
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

    // jobId optional (?jobId=uuid)
    let jobId = "";
    try {
      const url = new URL(req.url);
      jobId = (url.searchParams.get("jobId") || "").trim();
    } catch {}

    if (jobId) {
      const out = await processLegacyJob(supabase, jobId);
      return NextResponse.json({ ok: true, ...out, ran: "legacy_by_jobId" });
    }

    // pick next queued legacy job
    const { data: job, error: pickErr } = await supabase
      .from("presenter_video_jobs")
      .select("id")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (pickErr) return jsonError(500, "job_pick_failed", pickErr.message);

    if (!job?.id) {
      return NextResponse.json({ ok: true, didWork: false, message: "No queued jobs." });
    }

    const out = await processLegacyJob(supabase, job.id);
    return NextResponse.json({ ok: true, ...out, ran: "legacy_voiceover_mvp" });
  } catch (e: any) {
    console.error("VIDEO_WORKER_ERROR", e);
    return jsonError(500, "internal_error", e?.message ?? String(e));
  }
}