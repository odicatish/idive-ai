import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function timingSafeEqual(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function getAuthBearer(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || "";
}

function getQuerySecret(req: Request) {
  try {
    const url = new URL(req.url);
    return (url.searchParams.get("secret") || "").trim();
  } catch {
    return "";
  }
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// GET = health-check (te ajută la test în browser)
export async function GET(req: Request) {
  return json(200, { ok: true, route: "video-worker", method: "GET" });
}

export async function POST(req: Request) {
  try {
    // 1) Auth
    // - Cron: Authorization: Bearer <CRON_SECRET>
    // - Manual test: ?secret=<VIDEO_WORKER_SECRET>
    const bearer = getAuthBearer(req);
    const qpSecret = getQuerySecret(req);

    const cronSecret = process.env.CRON_SECRET || "";
    const workerSecret = process.env.VIDEO_WORKER_SECRET || "";

    const authedByCron =
      cronSecret && bearer && timingSafeEqual(bearer, cronSecret);

    const authedByWorker =
      workerSecret && qpSecret && timingSafeEqual(qpSecret, workerSecret);

    if (!authedByCron && !authedByWorker) {
      return json(401, { ok: false, error: "unauthorized_worker" });
    }

    // 2) Supabase admin
    const supabase = supabaseAdmin();

    // 3) Pick 1 queued job
    const { data: job, error: pickErr } = await supabase
      .from("presenter_video_jobs")
      .select("*")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (pickErr) return json(500, { ok: false, error: "job_pick_failed", details: pickErr.message });

    if (!job) {
      return json(200, { ok: true, didWork: false, message: "No queued jobs." });
    }

    // 4) Move to processing
    const { error: lockErr } = await supabase
      .from("presenter_video_jobs")
      .update({
        status: "processing",
        progress: 5,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    if (lockErr) return json(500, { ok: false, error: "job_lock_failed", details: lockErr.message });

    // 5) Mock pipeline
    await new Promise((r) => setTimeout(r, 400));
    await supabase.from("presenter_video_jobs").update({ progress: 25, updated_at: new Date().toISOString() }).eq("id", job.id);

    await new Promise((r) => setTimeout(r, 400));
    await supabase.from("presenter_video_jobs").update({ progress: 55, updated_at: new Date().toISOString() }).eq("id", job.id);

    await new Promise((r) => setTimeout(r, 400));
    await supabase.from("presenter_video_jobs").update({ progress: 85, updated_at: new Date().toISOString() }).eq("id", job.id);

    await new Promise((r) => setTimeout(r, 400));

    const fakeUrl = `https://example.com/videos/${job.presenter_id}/${job.id}.mp4`;

    const { error: doneErr } = await supabase
      .from("presenter_video_jobs")
      .update({
        status: "completed",
        progress: 100,
        video_url: fakeUrl,
        provider: "mock",
        provider_job_id: String(job.id),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    if (doneErr) return json(500, { ok: false, error: "job_complete_failed", details: doneErr.message });

    return json(200, {
      ok: true,
      didWork: true,
      job: { id: job.id, status: "completed", progress: 100, videoUrl: fakeUrl },
    });
  } catch (e: any) {
    console.error("VIDEO_WORKER_ERROR", e);
    return json(500, { ok: false, error: "internal_error", details: e?.message ?? String(e) });
  }
}