import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type RouteParams = { id: string } | Promise<{ id: string }>;

function jsonError(status: number, error: string, details?: any) {
  return NextResponse.json({ error, ...(details ? { details } : {}) }, { status });
}

async function getPresenterId(req: Request, params: RouteParams) {
  const resolved = await Promise.resolve(params).catch(() => null);
  const fromParams = resolved?.id;

  if (typeof fromParams === "string" && fromParams.trim()) {
    return decodeURIComponent(fromParams).trim();
  }

  try {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("presenters");
    const fromUrl = idx >= 0 ? parts[idx + 1] : "";
    return decodeURIComponent(String(fromUrl ?? "")).trim();
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

function normalizeVideoDirection(raw: any) {
  return {
    shot:
      typeof raw?.shot === "string" && raw.shot.trim()
        ? raw.shot.trim()
        : "medium",
    delivery:
      typeof raw?.delivery === "string" && raw.delivery.trim()
        ? raw.delivery.trim()
        : "executive",
    movement:
      typeof raw?.movement === "string" && raw.movement.trim()
        ? raw.movement.trim()
        : "static",
    background:
      typeof raw?.background === "string" && raw.background.trim()
        ? raw.background.trim()
        : "studio",
  };
}

function getPlanAndLimit(priceId: string | null, status: string | null) {
  const active = status === "active" || status === "trialing";

  if (active && priceId === (process.env.STRIPE_PRICE_ID_BUSINESS || "").trim()) {
    return { plan: "business", limit: 60 };
  }

  if (active && priceId === (process.env.STRIPE_PRICE_ID_PRO || "").trim()) {
    return { plan: "pro", limit: 20 };
  }

  return { plan: "free", limit: 1 };
}

export async function GET(req: Request, ctx: { params: RouteParams }) {
  const presenterId = await getPresenterId(req, ctx.params);
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

export async function POST(req: Request, ctx: { params: RouteParams }) {
  const presenterId = await getPresenterId(req, ctx.params);
  if (!presenterId) return jsonError(400, "invalid_presenter_id");

  const supabase = await supabaseServer();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return jsonError(401, "unauthorized");

  const { data: subscription, error: subErr } = await supabase
    .from("subscriptions")
    .select("status,price_id")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subErr) return jsonError(500, "subscription_load_failed", subErr.message);

  const billing = getPlanAndLimit(subscription?.price_id ?? null, subscription?.status ?? null);

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const { count: monthlyCompletedVideos, error: countErr } = await supabase
    .from("presenter_video_jobs")
    .select("*", { count: "exact", head: true })
    .eq("created_by", auth.user.id)
    .eq("status", "completed")
    .gte("created_at", startOfMonth.toISOString());

  if (countErr) return jsonError(500, "usage_count_failed", countErr.message);

  if ((monthlyCompletedVideos ?? 0) >= billing.limit) {
    return NextResponse.json(
      {
        error: "VIDEO_LIMIT_REACHED",
        message: `You reached the monthly limit of ${billing.limit} videos for the ${billing.plan} plan.`,
        plan: billing.plan,
        limit: billing.limit,
        used: monthlyCompletedVideos ?? 0,
      },
      { status: 403 }
    );
  }

  const { data: presenter, error: pErr } = await supabase
    .from("presenters")
    .select("id,user_id,context,use_case")
    .eq("id", presenterId)
    .maybeSingle();

  if (pErr) return jsonError(500, "presenter_load_failed", pErr.message);
  if (!presenter || presenter.user_id !== auth.user.id) return jsonError(404, "not_found");

  const presenterContext =
    presenter && typeof presenter.context === "object" && presenter.context
      ? presenter.context
      : {};

  const videoDirection = normalizeVideoDirection(presenterContext?.videoDirection);
  const useCase =
    typeof (presenter as any)?.use_case === "string" && (presenter as any).use_case.trim()
      ? String((presenter as any).use_case).trim()
      : null;

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
      renderConfig: {
        useCase,
        videoDirection,
      },
      billing: {
        plan: billing.plan,
        limit: billing.limit,
        used: monthlyCompletedVideos ?? 0,
        remaining: Math.max(0, billing.limit - (monthlyCompletedVideos ?? 0)),
      },
    });
  }

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

  const admin = supabaseAdminSafe();
  if (!admin.ok) {
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
      renderConfig: {
        useCase,
        videoDirection,
      },
      billing: {
        plan: billing.plan,
        limit: billing.limit,
        used: monthlyCompletedVideos ?? 0,
        remaining: Math.max(0, billing.limit - (monthlyCompletedVideos ?? 0)),
      },
    });
  }

  const sb = admin.client;

  const nowIso = new Date().toISOString();

  const renderMeta = {
    useCase,
    videoDirection,
    contextSnapshot: {
      location: presenterContext?.location ?? "",
      domain: presenterContext?.domain ?? "",
      audience: presenterContext?.audience ?? "",
      tone: presenterContext?.tone ?? "",
      visual: presenterContext?.visual ?? "",
      notes: presenterContext?.notes ?? "",
    },
    createdFrom: "studio_render",
    billing: {
      plan: billing.plan,
      limit: billing.limit,
      usedBeforeCreate: monthlyCompletedVideos ?? 0,
    },
  };

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
      renderConfig: {
        useCase,
        videoDirection,
      },
      billing: {
        plan: billing.plan,
        limit: billing.limit,
        used: monthlyCompletedVideos ?? 0,
        remaining: Math.max(0, billing.limit - (monthlyCompletedVideos ?? 0)),
      },
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
      renderConfig: {
        useCase,
        videoDirection,
      },
      billing: {
        plan: billing.plan,
        limit: billing.limit,
        used: monthlyCompletedVideos ?? 0,
        remaining: Math.max(0, billing.limit - (monthlyCompletedVideos ?? 0)),
      },
    });
  }

  let metaSaved = false;
  let metaSaveError: string | null = null;

  try {
    const { error: metaErr } = await sb
      .from("video_render_jobs")
      .update({
        meta: renderMeta,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", pipelineJob.id);

    if (metaErr) {
      metaSaveError = metaErr.message;
    } else {
      metaSaved = true;
    }
  } catch (e: any) {
    metaSaveError = e?.message ?? String(e);
  }

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
    renderConfig: {
      useCase,
      videoDirection,
    },
    pipelineMeta: {
      saved: metaSaved,
      error: metaSaveError,
    },
    billing: {
      plan: billing.plan,
      limit: billing.limit,
      used: monthlyCompletedVideos ?? 0,
      remaining: Math.max(0, billing.limit - (monthlyCompletedVideos ?? 0) - 1),
    },
  });
}