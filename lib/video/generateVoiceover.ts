// lib/video/generateVoiceover.ts
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

type AnyRow = Record<string, any>;

function requireEnv(name: string) {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getSupabaseUrl() {
  return (
    (process.env.SUPABASE_URL || "").trim() ||
    (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
  );
}

function makeSupabaseAdmin() {
  const url = getSupabaseUrl();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!url) throw new Error("Missing env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)");
  if (!serviceKey) throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getProjectRefFromUrl(url: string) {
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return null;
  }
}

export async function generateVoiceoverForJob(jobId: string) {
  const OPENAI_API_KEY = requireEnv("OPENAI_API_KEY");

  const supabase = makeSupabaseAdmin();
  const usedUrl = getSupabaseUrl();
  const projectRef = getProjectRefFromUrl(usedUrl);

  // 1) get job
  const { data: jobRaw, error: jobErr } = await supabase
    .from("video_render_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (jobErr) throw new Error(`job_fetch_failed: ${jobErr.message}`);
  const job = jobRaw as AnyRow | null;
  if (!job) throw new Error("Job not found");

  const scriptId = String(job.script_id || "");
  if (!scriptId) throw new Error("Job missing script_id");

  // 2) get script
  const { data: scriptRaw, error: scriptErr } = await supabase
    .from("presenter_scripts")
    .select("content, language")
    .eq("id", scriptId)
    .maybeSingle();

  if (scriptErr) throw new Error(`script_fetch_failed: ${scriptErr.message}`);
  const script = scriptRaw as AnyRow | null;
  if (!script) throw new Error("Script not found");

  const text = String(script.content || "").trim();
  if (!text) throw new Error("Script is empty (nothing to synthesize).");

  // 3) mark step processing
  const now = new Date().toISOString();
  const { error: stepStartErr } = await supabase
    .from("video_render_steps")
    .update({
      status: "processing",
      started_at: now,
      progress: 5,
      updated_at: now,
    } as any)
    .eq("job_id", jobId)
    .eq("step", "voiceover");

  if (stepStartErr) throw new Error(`voiceover_step_update_failed: ${stepStartErr.message}`);

  // 4) generate TTS
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  const speech = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "alloy",
    input: text,
  });

  const buffer = Buffer.from(await speech.arrayBuffer());
  if (!buffer?.length) throw new Error("TTS returned empty audio buffer.");

  // 5) upload to storage
  const bucket = "renders";
  const path = `voiceovers/${jobId}.mp3`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, buffer, {
      contentType: "audio/mpeg",
      upsert: true,
      cacheControl: "3600",
    });

  if (uploadError) throw new Error(`storage_upload_failed: ${uploadError.message}`);

  // 6) signed url (works for private buckets)
  const { data: signed, error: signedErr } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60 * 24 * 7);

  if (signedErr) throw new Error(`signed_url_failed: ${signedErr.message}`);

  // 7) create asset
  const { error: assetErr } = await supabase.from("video_assets").insert(
    {
      job_id: jobId,
      asset_type: "audio_voice",
      provider: "openai",
      status: "completed",
      storage_bucket: bucket,
      storage_path: path,
      public_url: signed?.signedUrl ?? null,
      meta: { projectRef, usedUrl },
    } as any
  );

  if (assetErr) throw new Error(`asset_insert_failed: ${assetErr.message}`);

  // 8) complete step
  const doneAt = new Date().toISOString();
  const { error: stepDoneErr } = await supabase
    .from("video_render_steps")
    .update({
      status: "completed",
      progress: 100,
      completed_at: doneAt,
      updated_at: doneAt,
    } as any)
    .eq("job_id", jobId)
    .eq("step", "voiceover");

  if (stepDoneErr) throw new Error(`voiceover_step_complete_failed: ${stepDoneErr.message}`);

  return {
    ok: true as const,
    bucket,
    path,
    signedUrl: signed?.signedUrl ?? null,
    debug: { projectRef, usedUrl },
  };
}