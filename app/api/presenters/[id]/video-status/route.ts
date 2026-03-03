import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

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

function isTerminal(s?: string | null) {
  const v = String(s || "").toLowerCase();
  return v === "completed" || v === "failed" || v === "canceled";
}

/**
 * Heuristic progress based on pipeline steps statuses.
 * Adjust weights any time; UI just needs monotonic progress.
 */
function computePipelineProgress(steps: Array<{ step: string; status: string; progress?: number | null }>) {
  const map = new Map(steps.map((s) => [String(s.step), s]));

  const stepProgress = (name: string, base: number) => {
    const s = map.get(name);
    if (!s) return 0;
    const st = String(s.status || "").toLowerCase();

    if (st === "completed") return base;
    if (st === "failed") return base; // keep last-known
    if (st === "processing" || st === "running") {
      const p = Number(s.progress ?? 0);
      // blend: base * 0.7 + base * 0.3 * (p/100)
      return Math.max(1, Math.round(base * (0.7 + 0.3 * Math.min(100, Math.max(0, p)) / 100)));
    }
    if (st === "queued") return 0;
    return 0;
  };

  // weights by step
  const storyboard = stepProgress("storyboard", 25);
  const voiceover = stepProgress("voiceover", 35);
  const render = stepProgress("render", 35);
  const finalize = stepProgress("finalize", 5);

  const total = storyboard + voiceover + render + finalize;
  return Math.min(100, Math.max(0, total));
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

  // Optional: ?jobId=...
  const url = new URL(req.url);
  const jobId = (url.searchParams.get("jobId") || "").trim();

  // 1) legacy job (used by UI today)
  let q = supabase
    .from("presenter_video_jobs")
    .select(
      "id,presenter_id,script_id,script_version,status,progress,provider,provider_job_id,video_url,error,created_at,updated_at"
    )
    .eq("presenter_id", presenterId);

  if (jobId) q = q.eq("id", jobId);

  const { data: jobs, error: jErr } = await q.order("created_at", { ascending: false }).limit(1);

  if (jErr) return jsonError(500, "job_load_failed", jErr.message);

  const legacy = jobs?.[0];
  if (!legacy) return jsonError(404, "job_missing");

  // 2) try to find linked pipeline job
  //    video_render_jobs.legacy_job_id = presenter_video_jobs.id
  const { data: pipelineJob, error: pjErr } = await supabase
    .from("public.video_render_jobs")
    .select("id,status,progress,created_at,updated_at,legacy_job_id,presenter_id")
    .eq("legacy_job_id", legacy.id)
    .maybeSingle();

  if (pjErr) {
    // don't fail the endpoint; just return legacy
    return NextResponse.json({
      job: {
        id: legacy.id,
        presenterId: legacy.presenter_id,
        scriptId: legacy.script_id,
        scriptVersion: legacy.script_version,
        status: legacy.status,
        progress: legacy.progress ?? 0,
        provider: legacy.provider ?? null,
        providerJobId: legacy.provider_job_id ?? null,
        videoUrl: legacy.video_url ?? null,
        error: legacy.error ?? null,
        createdAt: legacy.created_at,
        updatedAt: legacy.updated_at,
      },
      pipeline: null,
    });
  }

  if (!pipelineJob) {
    // no pipeline mapping yet
    return NextResponse.json({
      job: {
        id: legacy.id,
        presenterId: legacy.presenter_id,
        scriptId: legacy.script_id,
        scriptVersion: legacy.script_version,
        status: legacy.status,
        progress: legacy.progress ?? 0,
        provider: legacy.provider ?? null,
        providerJobId: legacy.provider_job_id ?? null,
        videoUrl: legacy.video_url ?? null,
        error: legacy.error ?? null,
        createdAt: legacy.created_at,
        updatedAt: legacy.updated_at,
      },
      pipeline: null,
    });
  }

  // 3) load steps for progress
  const { data: steps, error: stepsErr } = await supabase
    .from("public.video_render_steps")
    .select("step,status,progress,started_at,completed_at,updated_at,error_message")
    .eq("job_id", pipelineJob.id);

  // 4) try to find final video asset (optional)
  // adjust asset_type if your schema differs
  const { data: videoAsset } = await supabase
    .from("public.video_assets")
    .select("public_url,storage_bucket,storage_path,status,asset_type,created_at")
    .eq("job_id", pipelineJob.id)
    .eq("asset_type", "video")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const pipelineProgress =
    !stepsErr && Array.isArray(steps) ? computePipelineProgress(steps as any) : Number(pipelineJob.progress ?? 0);

  const pipelineStatus = String(pipelineJob.status ?? "processing");
  const terminal = isTerminal(pipelineStatus);

  // 5) For UI compatibility: override legacy status/progress with pipeline-derived values
  const effectiveStatus = terminal ? pipelineStatus : pipelineStatus;
  const effectiveProgress = terminal ? 100 : pipelineProgress;

  const effectiveVideoUrl =
    (videoAsset as any)?.public_url ||
    legacy.video_url ||
    null;

  return NextResponse.json({
    job: {
      id: legacy.id,
      presenterId: legacy.presenter_id,
      scriptId: legacy.script_id,
      scriptVersion: legacy.script_version,
      status: effectiveStatus,
      progress: effectiveProgress,
      provider: legacy.provider ?? "pipeline",
      providerJobId: legacy.provider_job_id ?? pipelineJob.id,
      videoUrl: effectiveVideoUrl,
      error: legacy.error ?? null,
      createdAt: legacy.created_at,
      updatedAt: legacy.updated_at,
    },
    pipeline: {
      id: pipelineJob.id,
      status: pipelineStatus,
      progress: pipelineProgress,
      steps: Array.isArray(steps) ? steps : null,
      videoUrl: (videoAsset as any)?.public_url ?? null,
    },
  });
}