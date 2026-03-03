import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

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

function computePipelineProgress(
  steps: Array<{ step: string; status: string; progress?: number | null }>
) {
  const map = new Map(steps.map((s) => [String(s.step), s]));

  const stepProgress = (name: string, weight: number) => {
    const s = map.get(name);
    if (!s) return 0;

    const st = String(s.status || "").toLowerCase();
    if (st === "completed") return weight;
    if (st === "failed") return weight;

    if (st === "processing" || st === "running") {
      const p = Math.min(100, Math.max(0, Number(s.progress ?? 0)));
      return Math.max(1, Math.round(weight * (0.6 + 0.4 * (p / 100))));
    }

    return 0; // queued/unknown
  };

  // weights (tune later)
  const storyboard = stepProgress("storyboard", 25);
  const voiceover = stepProgress("voiceover", 35);
  const render = stepProgress("render", 35);
  const finalize = stepProgress("finalize", 5);

  return Math.min(100, Math.max(0, storyboard + voiceover + render + finalize));
}

function supabaseAdminSafe() {
  const usedUrl =
    (process.env.SUPABASE_URL || "").trim() ||
    (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!usedUrl || !serviceKey) {
    return {
      ok: false as const,
      error: "missing_supabase_admin_env",
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

export async function GET(req: Request, context: any) {
  const presenterId = getPresenterId(req, context);
  if (!presenterId) return jsonError(400, "invalid_presenter_id");

  const url = new URL(req.url);
  const jobId = (url.searchParams.get("jobId") || "").trim();
  const debug = (url.searchParams.get("debug") || "").trim() === "1";

  // 1) auth + ownership check (user session)
  const supabase = await supabaseServer();
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return jsonError(401, "unauthorized");

  const { data: presenter, error: pErr } = await supabase
    .from("presenters")
    .select("id,user_id")
    .eq("id", presenterId)
    .maybeSingle();

  if (pErr) return jsonError(500, "presenter_load_failed", pErr.message);
  if (!presenter || presenter.user_id !== auth.user.id) return jsonError(404, "not_found");

  // 2) get latest legacy job (UI job)
  let q = supabase
    .from("presenter_video_jobs")
    .select(
      "id,presenter_id,script_id,script_version,status,progress,provider,provider_job_id,video_url,error,created_at,updated_at"
    )
    .eq("presenter_id", presenterId);

  if (jobId) q = q.eq("id", jobId);

  const { data: jobs, error: jErr } = await q
    .order("created_at", { ascending: false })
    .limit(1);

  if (jErr) return jsonError(500, "job_load_failed", jErr.message);

  const legacy = jobs?.[0];
  if (!legacy) return jsonError(404, "job_missing");

  // 3) pipeline read via service role (bypass RLS)
  const admin = supabaseAdminSafe();
  if (!admin.ok) {
    // still return legacy job so UI doesn't crash
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
      ...(debug ? { debug: { adminEnv: admin.details } } : {}),
    });
  }

  const sb = admin.client;

  const dbg: any = {};

  // 3a) try by legacy_job_id
  let pipelineJob: any = null;

  const { data: byLegacy, error: byLegacyErr } = await sb
    .from("video_render_jobs")
    .select("id,status,progress,created_at,updated_at,legacy_job_id,presenter_id")
    .eq("legacy_job_id", legacy.id)
    .maybeSingle();

  if (byLegacyErr && debug) dbg.byLegacyErr = byLegacyErr.message;
  if (byLegacy) pipelineJob = byLegacy;

  // 3b) fallback: latest by presenter_id
  if (!pipelineJob) {
    const { data: byPresenter, error: byPresenterErr } = await sb
      .from("video_render_jobs")
      .select("id,status,progress,created_at,updated_at,legacy_job_id,presenter_id")
      .eq("presenter_id", presenterId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (byPresenterErr && debug) dbg.byPresenterErr = byPresenterErr.message;
    if (byPresenter) pipelineJob = byPresenter;
  }

  // if still none, return legacy
  if (!pipelineJob) {
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
      ...(debug ? { debug: { ...dbg, note: "No pipeline job found for this presenter/legacy job." } } : {}),
    });
  }

  // 4) read steps
  const { data: steps, error: stepsErr } = await sb
    .from("video_render_steps")
    .select("step,status,progress,started_at,completed_at,updated_at,error_message")
    .eq("job_id", pipelineJob.id);

  if (stepsErr && debug) dbg.stepsErr = stepsErr.message;

  const pipelineProgress =
    !stepsErr && Array.isArray(steps)
      ? computePipelineProgress(steps as any)
      : Number(pipelineJob.progress ?? 0);

  const pipelineStatus = String(pipelineJob.status ?? "processing");
  const terminal = isTerminal(pipelineStatus);

  // 5) find latest video asset (if exists)
  const { data: videoAsset, error: assetErr } = await sb
    .from("video_assets")
    .select("public_url,storage_bucket,storage_path,status,asset_type,created_at")
    .eq("job_id", pipelineJob.id)
    .eq("asset_type", "video")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (assetErr && debug) dbg.assetErr = assetErr.message;

  const effectiveVideoUrl = (videoAsset as any)?.public_url || legacy.video_url || null;

  // 6) return UI job "as pipeline"
  return NextResponse.json({
    job: {
      id: legacy.id,
      presenterId: legacy.presenter_id,
      scriptId: legacy.script_id,
      scriptVersion: legacy.script_version,
      status: terminal ? pipelineStatus : pipelineStatus,
      progress: terminal ? 100 : pipelineProgress,
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
      legacy_job_id: pipelineJob.legacy_job_id ?? null,
    },
    ...(debug ? { debug: dbg } : {}),
  });
}