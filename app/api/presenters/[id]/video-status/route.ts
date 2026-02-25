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
  });
}