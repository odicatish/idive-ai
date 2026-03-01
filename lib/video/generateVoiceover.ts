import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // IMPORTANT: service role
);

export async function generateVoiceoverForJob(jobId: string) {

  // 1️⃣ get job
  const { data: job } = await supabase
    .from("video_render_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (!job) throw new Error("Job not found");

  // 2️⃣ get script
  const { data: script } = await supabase
    .from("presenter_scripts")
    .select("content, language")
    .eq("id", job.script_id)
    .single();

  if (!script) throw new Error("Script not found");

  // 3️⃣ mark step processing
  await supabase
    .from("video_render_steps")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .eq("job_id", jobId)
    .eq("step", "voiceover");

  // 4️⃣ generate TTS
  const speech = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "alloy",
    input: script.content,
  });

  const buffer = Buffer.from(await speech.arrayBuffer());

  // 5️⃣ upload to storage
  const path = `voiceovers/${jobId}.mp3`;

  const { error: uploadError } = await supabase.storage
    .from("renders")
    .upload(path, buffer, {
      contentType: "audio/mpeg",
      upsert: true,
    });

  if (uploadError) throw uploadError;

  // 6️⃣ get public url (signed)
  const { data: signed } = await supabase.storage
    .from("renders")
    .createSignedUrl(path, 60 * 60 * 24 * 7);

  // 7️⃣ create asset
  await supabase.from("video_assets").insert({
    job_id: jobId,
    asset_type: "audio_voice",
    provider: "openai",
    status: "completed",
    storage_bucket: "renders",
    storage_path: path,
    public_url: signed?.signedUrl,
  });

  // 8️⃣ complete step
  await supabase
    .from("video_render_steps")
    .update({
      status: "completed",
      progress: 100,
      completed_at: new Date().toISOString(),
    })
    .eq("job_id", jobId)
    .eq("step", "voiceover");

  return true;
}