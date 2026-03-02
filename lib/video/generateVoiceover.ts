import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  const url =
    (process.env.SUPABASE_URL || "").trim() ||
    (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();

  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!url) throw new Error("Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function generateVoiceoverForJob(jobId: string) {
  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  // 1) get job
  const { data: job, error: jobErr } = await supabase
    .from("video_render_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (jobErr) throw new Error(`Job fetch failed: ${jobErr.message}`);
  if (!job) throw new Error("Job not found");

  // 2) get script
  const { data: script, error: scriptErr } = await supabase
    .from("presenter_scripts")
    .select("content, language")
    .eq("id", job.script_id)
    .single();

  if (scriptErr) throw new Error(`Script fetch failed: ${scriptErr.message}`);
  if (!script) throw new Error("Script not found");

  // 3) mark step processing
  await supabase
    .from("video_render_steps")
    .update({
      status: "processing",
      progress: 10,
      started_at: nowIso,
      updated_at: nowIso,
      error_message: null,
    })
    .eq("job_id", jobId)
    .eq("step", "voiceover");

  // 4) generate TTS
  const speech = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "alloy",
    input: script.content,
  });

  const buffer = Buffer.from(await speech.arrayBuffer());

  // 5) upload to storage
  const path = `voiceovers/${jobId}.mp3`;

  const { error: uploadError } = await supabase.storage
    .from("renders")
    .upload(path, buffer, {
      contentType: "audio/mpeg",
      upsert: true,
    });

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  // 6) signed url
  const { data: signed, error: signedErr } = await supabase.storage
    .from("renders")
    .createSignedUrl(path, 60 * 60 * 24 * 7);

  if (signedErr) throw new Error(`Signed URL failed: ${signedErr.message}`);

  // 7) create asset
  const { error: assetErr } = await supabase.from("video_assets").insert({
    job_id: jobId,
    asset_type: "audio_voice",
    provider: "openai",
    status: "completed",
    storage_bucket: "renders",
    storage_path: path,
    public_url: signed?.signedUrl,
  });

  if (assetErr) throw new Error(`Asset insert failed: ${assetErr.message}`);

  // 8) complete step
  await supabase
    .from("video_render_steps")
    .update({
      status: "completed",
      progress: 100,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("job_id", jobId)
    .eq("step", "voiceover");

  return true;
}