import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonError(status: number, error: string, details?: any) {
  const res = NextResponse.json({ error, ...(details ? { details } : {}) }, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
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

// mapping simplu steps -> %
function pipelineProgressFromSteps(steps: Array<{ step: string; status: string }> | null) {
  if (!steps || steps.length === 0) return 0;

  const statusOf = (name: string) => steps.find((s) => s.step === name)?.status ?? "queued";

  const storyboard = statusOf("storyboard");
  const voiceover = statusOf("voiceover");
  const composition = statusOf("composition");
  const exportStep = statusOf("export");

  if ([storyboard, voiceover, composition, exportStep].includes("failed")) return 5;

  if (exportStep === "completed") return 100;
  if (composition === "completed") return 90;
  if (voiceover === "completed") return 35;
  if (storyboard === "completed") return 15;

  if (voiceover === "processing") return 25;
  if (storyboard === "processing") return 10;

  return 1;
}

export async function GET(req: Request, context: any) {
  const presenterId = getPresenterId(req, context);
  if (!presenterId) return jsonError(400, "invalid_presenter_id");

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

  const url = new URL(req.url);
  const jobId = (url.searchParams.get("jobId") || "").trim();

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

  // pipeline (best-effort)
  let pipelineJobId: string | null = null;
  let pipelineSteps: Array<{ step: string; status: string; progress?: number | null }> | null = null;
  let voiceoverUrl: string | null = null;

  try {
    const { data: prj } = await supabase
      .from("video_render_jobs")
      .select("id")
      .eq("legacy_job_id", job.id)
      .maybeSingle();

    if (prj?.id) {
      pipelineJobId = prj.id;

      const { data: steps } = await supabase
        .from("video_render_steps")
        .select("step,status,progress")
        .eq("job_id", pipelineJobId);

      pipelineSteps = (steps ?? null) as any;

      const { data: asset } = await supabase
        .from("video_assets")
        .select("public_url,status,created_at")
        .eq("job_id", pipelineJobId)
        .eq("asset_type", "audio_voice")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (asset?.public_url && asset?.status === "completed") {
        voiceoverUrl = asset.public_url as string;
      }
    }
  } catch {
    // ignore
  }

  const legacyProgress = Number(job.progress ?? 0);
  const pipelineProgress = pipelineProgressFromSteps(
    pipelineSteps?.map((s: any) => ({ step: s.step, status: s.status })) ?? null
  );

  const effectiveProgress = legacyProgress > 0 ? legacyProgress : pipelineProgress;

  const res = NextResponse.json({
    job: {
      id: job.id,
      presenterId: job.presenter_id,
      scriptId: job.script_id,
      scriptVersion: job.script_version,
      status: job.status,
      progress: effectiveProgress,
      provider: job.provider ?? null,
      providerJobId: job.provider_job_id ?? null,
      videoUrl: job.video_url ?? null,
      error: job.error ?? null,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    },
    pipeline: pipelineJobId
      ? {
          jobId: pipelineJobId,
          steps: pipelineSteps ?? [],
          voiceoverUrl: voiceoverUrl ?? null,
        }
      : null,
  });

  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}