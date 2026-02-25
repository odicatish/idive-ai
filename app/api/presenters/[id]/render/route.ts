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
  return NextResponse.json(
    {
      error: "method_not_allowed",
      message:
        "This endpoint creates a render job. Use POST (not GET). Open /studio/{presenterId} and click 'Render Video'.",
      presenterId: presenterId || null,
    },
    { status: 405 }
  );
}

export async function POST(req: Request, context: any) {
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

  // get current script
  const { data: script, error: sErr } = await supabase
    .from("presenter_scripts")
    .select("id,version,content")
    .eq("presenter_id", presenterId)
    .maybeSingle();

  if (sErr) return jsonError(500, "script_load_failed", sErr.message);
  if (!script) return jsonError(404, "script_missing");

  if (!script.content || script.content.trim().length < 40) {
    return jsonError(422, "script_too_short_for_video");
  }

  // 1) If there is already an active job, return it (avoid duplicates)
  const ACTIVE = ["queued", "running", "processing"];

  const { data: existingJob, error: exErr } = await supabase
    .from("presenter_video_jobs")
    .select("id,status,progress,created_at,script_id,script_version")
    .eq("presenter_id", presenterId)
    .in("status", ACTIVE)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (exErr) return jsonError(500, "job_check_failed", exErr.message);

  if (existingJob) {
    return NextResponse.json({
      existing: true,
      job: {
        id: existingJob.id,
        status: existingJob.status,
        progress: existingJob.progress ?? 0,
        createdAt: existingJob.created_at,
        scriptId: existingJob.script_id,
        scriptVersion: existingJob.script_version,
      },
    });
  }

  // 2) Otherwise create a new job
  const { data: job, error: jErr } = await supabase
    .from("presenter_video_jobs")
    .insert({
      presenter_id: presenterId,
      script_id: script.id,
      script_version: script.version,
      status: "queued",
      progress: 0,
      created_by: auth.user.id,
    })
    .select("id,status,progress,created_at,script_id,script_version")
    .single();

  if (jErr) return jsonError(500, "job_create_failed", jErr.message);

  return NextResponse.json({
    existing: false,
    job: {
      id: job.id,
      status: job.status,
      progress: job.progress ?? 0,
      createdAt: job.created_at,
      scriptId: job.script_id,
      scriptVersion: job.script_version,
    },
  });
}