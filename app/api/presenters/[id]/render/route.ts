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

  // 1) avoid duplicate active legacy jobs
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

  // 2) create legacy job
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
    .select("id,status,progress,created_at,script_id,script_version,presenter_id")
    .single();

  if (jErr) return jsonError(500, "job_create_failed", jErr.message);

  // 3) create pipeline job + seed steps (SERVICE ROLE)
  const admin = supabaseAdminSafe();
  if (!admin.ok) {
    // legacy job exists; UI still works, but pipeline won't run
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
      pipelineCreated: false,
      pipelineError: admin.details,
    });
  }

  const sb = admin.client;

  // upsert pipeline job linked to legacy job
  const nowIso = new Date().toISOString();
  const payload = {
    legacy_job_id: job.id,
    presenter_id: job.presenter_id,
    script_id: job.script_id,
    script_version: job.script_version,
    user_id: auth.user.id,
    status: "processing",
    progress: 0,
    updated_at: nowIso,
  };

  const { error: upsertErr } = await sb
    .from("video_render_jobs")
    .upsert(payload, { onConflict: "legacy_job_id" });

  if (upsertErr) {
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
      pipelineCreated: false,
      pipelineError: upsertErr.message,
    });
  }

  const { data: pipelineJob, error: fetchPipeErr } = await sb
    .from("video_render_jobs")
    .select("id,legacy_job_id,presenter_id")
    .eq("legacy_job_id", job.id)
    .maybeSingle();

  if (fetchPipeErr || !pipelineJob?.id) {
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
      pipelineCreated: false,
      pipelineError: fetchPipeErr?.message ?? "pipeline_job_missing_after_upsert",
    });
  }

  // seed steps (best-effort)
  try {
    await sb.rpc("seed_video_render_steps", { p_job_id: pipelineJob.id });
  } catch {
    // ignore
  }

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
    pipelineCreated: true,
    pipelineJobId: pipelineJob.id,
  });
}