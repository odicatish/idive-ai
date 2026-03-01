// app/api/video-worker/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { generateVoiceoverForJob } from "@/lib/video/generateVoiceover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(status: number, error: string, details?: any) {
  return NextResponse.json(
    { ok: false, error, ...(details ? { details } : {}) },
    { status }
  );
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

/**
 * IMPORTANT:
 * Worker-ul trebuie să folosească SUPABASE_URL (server-side).
 * Am păstrat fallback, dar îți arătăm în răspuns ce URL a fost folosit.
 */
function supabaseAdmin() {
  const usedUrl =
    (process.env.SUPABASE_URL || "").trim() ||
    (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!usedUrl) throw new Error("Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  const client = createClient(usedUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Supabase project ref e subdomeniul din https://<ref>.supabase.co
  const projectRef = (() => {
    try {
      const u = new URL(usedUrl);
      const host = u.hostname; // <ref>.supabase.co
      return host.split(".")[0] || null;
    } catch {
      return null;
    }
  })();

  return { client, usedUrl, projectRef };
}

async function ensurePipelineJobForLegacyJob(supabase: any, legacyJob: any) {
  const nowIso = new Date().toISOString();

  // upsert pipeline job linked to legacy job
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

  // best-effort seed steps (daca ai functia)
  try {
    await supabase.rpc("seed_video_render_steps", { p_job_id: pipelineJob.id });
  } catch {}

  return pipelineJob.id as string;
}

async function canRunVoiceover(supabase: any, pipelineJobId: string) {
  const { data: steps, error } = await supabase
    .from("video_render_steps")
    .select("step,status")
    .eq("job_id", pipelineJobId);

  if (error) throw new Error(`steps_fetch_failed: ${error.message}`);
  if (!steps) return false;

  const storyboard = steps.find((s: any) => s.step === "storyboard");
  const voiceover = steps.find((s: any) => s.step === "voiceover");
  return storyboard?.status === "completed" && voiceover?.status === "queued";
}

export async function GET(req: Request) {
  // GET = healthcheck public (NU procesează job-uri)
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

    const { client: supabase, usedUrl, projectRef } = supabaseAdmin();

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

    const nowIso = new Date().toISOString();

    // 2) atomic lock
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
      .select("id,status,progress,presenter_id,script_id,script_version,created_by")
      .maybeSingle();

    if (lockErr) return jsonError(500, "job_lock_failed", { message: lockErr.message, usedUrl, projectRef });

    if (!locked) {
      return NextResponse.json({
        ok: true,
        didWork: false,
        message: "Job was already taken by another worker run.",
        debug: { usedUrl, projectRef },
      });
    }

    // 3) ensure pipeline job exists
    let pipelineJobId: string | null = null;
    try {
      pipelineJobId = await ensurePipelineJobForLegacyJob(supabase, job);
    } catch (e: any) {
      console.error("PIPELINE_LINK_ERROR", e?.message ?? e);
      await supabase
        .from("presenter_video_jobs")
        .update({
          error: `pipeline_link_error: ${e?.message ?? String(e)}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
    }

    // 4) try voiceover if eligible
    let voiceoverRan = false;
    if (pipelineJobId) {
      try {
        const okToRun = await canRunVoiceover(supabase, pipelineJobId);
        if (okToRun) {
          await generateVoiceoverForJob(pipelineJobId);
          voiceoverRan = true;

          await supabase
            .from("presenter_video_jobs")
            .update({ progress: 20, updated_at: new Date().toISOString() })
            .eq("id", job.id);
        }
      } catch (e: any) {
        console.error("VOICEOVER_ERROR", e?.message ?? e);
        try {
          await supabase
            .from("video_render_steps")
            .update({
              status: "failed",
              error_message: e?.message ?? String(e),
              updated_at: new Date().toISOString(),
            })
            .eq("job_id", pipelineJobId)
            .eq("step", "voiceover");
        } catch {}
        await supabase
          .from("presenter_video_jobs")
          .update({
            error: `voiceover_error: ${e?.message ?? String(e)}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);
      }
    }

    // 5) keep existing mock progress (so UI still works)
    await new Promise((r) => setTimeout(r, 250));
    await supabase
      .from("presenter_video_jobs")
      .update({ progress: 25, updated_at: new Date().toISOString() })
      .eq("id", job.id);

    await new Promise((r) => setTimeout(r, 250));
    await supabase
      .from("presenter_video_jobs")
      .update({ progress: 55, updated_at: new Date().toISOString() })
      .eq("id", job.id);

    await new Promise((r) => setTimeout(r, 250));
    await supabase
      .from("presenter_video_jobs")
      .update({ progress: 85, updated_at: new Date().toISOString() })
      .eq("id", job.id);

    const fakeUrl = `https://example.com/videos/${job.presenter_id}/${job.id}.mp4`;

    // 6) complete legacy job
    const { error: doneErr } = await supabase
      .from("presenter_video_jobs")
      .update({
        status: "completed",
        progress: 100,
        video_url: fakeUrl,
        provider: voiceoverRan ? "mock+openai-tts" : "mock",
        provider_job_id: String(job.id),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    if (doneErr) return jsonError(500, "job_complete_failed", { message: doneErr.message, usedUrl, projectRef });

    return NextResponse.json({
      ok: true,
      didWork: true,
      ranVoiceover: voiceoverRan,
      pipelineJobId,
      job: { id: job.id, status: "completed", progress: 100, videoUrl: fakeUrl },
      debug: { usedUrl, projectRef },
    });
  } catch (e: any) {
    console.error("VIDEO_WORKER_ERROR", e);
    return jsonError(500, "internal_error", e?.message ?? String(e));
  }
}