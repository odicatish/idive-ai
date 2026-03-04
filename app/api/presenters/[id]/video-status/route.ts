import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonError(status: number, error: string, details?: any) {
  return NextResponse.json({ error, ...(details ? { details } : {}) }, { status });
}

function getPresenterId(req: Request, context: any) {
  const fromParams = context?.params?.id;
  if (typeof fromParams === "string" && fromParams.trim()) {
    return decodeURIComponent(fromParams).trim();
  }

  try {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("presenters");
    return idx >= 0 ? parts[idx + 1] : "";
  } catch {
    return "";
  }
}

type StepRow = {
  step: string;
  status: string;
  progress: number | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
  error_message: string | null;
};

function normStatus(s: any) {
  return String(s ?? "").toLowerCase();
}

function isFailed(s: string) {
  return normStatus(s) === "failed";
}

function isCompleted(s: string) {
  return normStatus(s) === "completed";
}

function isProcessing(s: string) {
  const v = normStatus(s);
  return v === "processing" || v === "running";
}

/**
 * Progres "real" pipeline (media pe pași). (debug/viitor)
 */
function computePipelineProgress(steps: StepRow[]) {
  if (!steps || steps.length === 0) {
    return { status: "queued", progress: 0 };
  }

  if (steps.some((x) => isFailed(x.status))) {
    const p = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          steps.reduce((acc, s) => {
            const st = normStatus(s.status);
            const v =
              st === "completed"
                ? 100
                : st === "processing" || st === "running"
                ? Number(s.progress ?? 0)
                : 0;
            return acc + v;
          }, 0) / steps.length
        )
      )
    );
    return { status: "failed", progress: p };
  }

  if (steps.every((x) => isCompleted(x.status))) {
    return { status: "completed", progress: 100 };
  }

  const anyProcessing = steps.some((x) => isProcessing(x.status));
  const p = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        steps.reduce((acc, s) => {
          const st = normStatus(s.status);
          const v =
            st === "completed"
              ? 100
              : st === "processing" || st === "running"
              ? Number(s.progress ?? 0)
              : 0;
          return acc + v;
        }, 0) / steps.length
      )
    )
  );

  return { status: anyProcessing ? "processing" : "queued", progress: p };
}

/**
 * ✅ MVP UI mapping:
 * Considerăm job "gata" când VOICEOVER e completed.
 */
function computeMvpUiFromVoiceover(steps: StepRow[]) {
  const vo = steps?.find((s) => s.step === "voiceover");
  const st = normStatus(vo?.status);

  if (st === "completed") return { status: "completed", progress: 100 };
  if (st === "failed") return { status: "failed", progress: Math.max(0, Number(vo?.progress ?? 0)) };

  if (st === "processing" || st === "running") {
    const p = Number(vo?.progress ?? 10);
    return { status: "processing", progress: Math.max(1, Math.min(99, p)) };
  }

  return { status: "queued", progress: 0 };
}

export async function GET(req: Request, context: any) {
  const presenterId = getPresenterId(req, context);
  if (!presenterId) return jsonError(400, "invalid_presenter_id");

  const supabase = await supabaseServer();

  // auth
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return jsonError(401, "unauthorized");

  // verify presenter owner
  const { data: presenter, error: pErr } = await supabase
    .from("presenters")
    .select("id,user_id")
    .eq("id", presenterId)
    .maybeSingle();

  if (pErr) return jsonError(500, "presenter_load_failed", pErr.message);
  if (!presenter || presenter.user_id !== auth.user.id) return jsonError(404, "not_found");

  const url = new URL(req.url);
  const jobId = (url.searchParams.get("jobId") || "").trim();

  // 1) legacy job (latest)
  let q = supabase
    .from("presenter_video_jobs")
    .select(
      "id,presenter_id,script_id,script_version,status,progress,provider,provider_job_id,video_url,error,created_at,updated_at"
    )
    .eq("presenter_id", presenterId);

  if (jobId) q = q.eq("id", jobId);

  const { data: jobs, error: jErr } = await q.order("created_at", { ascending: false }).limit(1);
  if (jErr) return jsonError(500, "job_load_failed", jErr.message);

  const job = jobs?.[0];
  if (!job) return jsonError(404, "job_missing");

  // 2) pipeline job legat (dacă există)
  const { data: pipelineJob, error: pjErr } = await supabase
    .from("video_render_jobs")
    .select("id,status,progress,legacy_job_id")
    .eq("legacy_job_id", job.id)
    .maybeSingle();

  if (pjErr) {
    return NextResponse.json({
      job: {
        id: job.id,
        presenterId: job.presenter_id,
        scriptId: job.script_id,
        scriptVersion: job.script_version,
        status: job.status,
        progress: job.progress ?? 0,
        provider: job.provider ?? null,
        providerJobId: job.provider_job_id ?? null,
        videoUrl: job.video_url ?? null,
        error: job.error ?? null,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
      },
      pipeline: null,
      debug: { note: "pipeline_lookup_failed", message: pjErr.message },
    });
  }

  if (!pipelineJob?.id) {
    return NextResponse.json({
      job: {
        id: job.id,
        presenterId: job.presenter_id,
        scriptId: job.script_id,
        scriptVersion: job.script_version,
        status: job.status,
        progress: job.progress ?? 0,
        provider: job.provider ?? null,
        providerJobId: job.provider_job_id ?? null,
        videoUrl: job.video_url ?? null,
        error: job.error ?? null,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
      },
      pipeline: null,
      debug: { note: "No pipeline job found for this presenter/legacy job." },
    });
  }

  // 3) pipeline steps
  const { data: stepsRaw, error: stepsErr } = await supabase
    .from("video_render_steps")
    .select("step,status,progress,started_at,completed_at,updated_at,error_message")
    .eq("job_id", pipelineJob.id)
    .order("step", { ascending: true });

  const steps: StepRow[] = Array.isArray(stepsRaw) ? (stepsRaw as any) : [];

  // 4) ✅ preferăm MP4 din Storage (NU din video_assets, fiindcă asset_type e ENUM și "video_mp4" nu e acceptat)
  const mp4Bucket = "renders";
  const mp4Path = `videos/${pipelineJob.id}.mp4`;

  let mp4Url: string | null = null;
  let mp4SignErr: string | null = null;

  try {
    const { data: signed, error: signErr } = await supabase.storage
      .from(mp4Bucket)
      .createSignedUrl(mp4Path, 60 * 60 * 24 * 7);

    if (signErr) {
      mp4SignErr = signErr.message;
    } else {
      mp4Url = signed?.signedUrl ?? null;
    }
  } catch (e: any) {
    mp4SignErr = e?.message ?? String(e);
  }

  // fallback audio (merge sigur, enum acceptă "audio_voice")
  let audioUrl: string | null = null;
  let audioErr: string | null = null;

  try {
    const { data: assetAudio, error: aErr } = await supabase
      .from("video_assets")
      .select("public_url,asset_type,status,created_at")
      .eq("job_id", pipelineJob.id)
      .eq("asset_type", "audio_voice")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (aErr) audioErr = aErr.message;
    audioUrl = assetAudio?.public_url ?? null;
  } catch (e: any) {
    audioErr = e?.message ?? String(e);
  }

  const pipelineVideoUrl = mp4Url ?? audioUrl ?? null;

  if (stepsErr) {
    const p = Number(job.progress ?? pipelineJob.progress ?? 0);

    return NextResponse.json({
      job: {
        id: job.id,
        presenterId: job.presenter_id,
        scriptId: job.script_id,
        scriptVersion: job.script_version,
        status: job.status,
        progress: p,
        provider: job.provider ?? "pipeline",
        providerJobId: pipelineJob.id,
        videoUrl: job.video_url ?? pipelineVideoUrl ?? null,
        error: job.error ?? null,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
      },
      pipeline: {
        id: pipelineJob.id,
        status: pipelineJob.status ?? "processing",
        progress: Number(pipelineJob.progress ?? 0),
        steps: [],
        videoUrl: pipelineVideoUrl,
        legacy_job_id: pipelineJob.legacy_job_id,
      },
      debug: {
        note: "steps_fetch_failed",
        message: stepsErr.message,
        assetsDebug: { mp4Path, mp4SignErr, audioErr },
      },
    });
  }

  const mvpUi = computeMvpUiFromVoiceover(steps);
  const computedPipeline = computePipelineProgress(steps);

  return NextResponse.json({
    job: {
      id: job.id,
      presenterId: job.presenter_id,
      scriptId: job.script_id,
      scriptVersion: job.script_version,
      status: mvpUi.status,
      progress: mvpUi.progress,
      provider: "pipeline",
      providerJobId: pipelineJob.id,
      videoUrl: pipelineVideoUrl ?? job.video_url ?? null,
      error: job.error ?? null,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    },
    pipeline: {
      id: pipelineJob.id,
      status: computedPipeline.status,
      progress: computedPipeline.progress,
      steps,
      videoUrl: pipelineVideoUrl,
      legacy_job_id: pipelineJob.legacy_job_id,
    },
    debug: {
      uiMode: "mvp_voiceover_complete_is_done",
      assetsDebug: {
        mp4Path,
        mp4Signed: !!mp4Url,
        mp4SignErr,
        audioErr,
      },
    },
  });
}