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

function normalizeForTTS(raw: string, lang?: string) {
  let t = (raw || "").trim();

  // normalize newlines / spaces
  t = t.replace(/\r\n/g, "\n");
  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/\n{3,}/g, "\n\n");

  // add gentle pauses (line breaks help most TTS engines)
  // - split after sentence endings when a new sentence begins
  t = t.replace(/([.!?])(\s+)([A-ZĂÂÎȘȚ])/g, "$1\n$3");

  // - after ":" add a new line (useful for enumerations)
  t = t.replace(/:\s*/g, ":\n");

  // small RO improvements
  const isRo = String(lang || "").toLowerCase().startsWith("ro");
  if (isRo) {
    t = t.replace(/\s&\s/g, " și ");
    t = t.replace(/%/g, " la sută");
    t = t.replace(/\+/g, " plus ");
    // 10-20 -> 10 până la 20 (more natural)
    t = t.replace(/\b(\d+)\s*-\s*(\d+)\b/g, "$1 până la $2");
  } else {
    // EN-ish defaults
    t = t.replace(/\s&\s/g, " and ");
    t = t.replace(/%/g, " percent");
  }

  return t;
}

function buildVoiceDirection(lang?: string) {
  const isRo = String(lang || "").toLowerCase().startsWith("ro");
  // Very short, so we don't "waste" too many tokens and we keep cost down.
  // This often helps reduce the "robotic" cadence.
  if (isRo) {
    return [
      "Stil de voce: natural, cald, conversațional.",
      "Ritmul: moderat, cu pauze scurte între propoziții.",
      "Pronunță clar, fără ton robotic.",
      "",
    ].join("\n");
  }

  return [
    "Voice style: natural, warm, conversational.",
    "Pace: medium, with short pauses between sentences.",
    "Speak clearly, avoid robotic cadence.",
    "",
  ].join("\n");
}

function pickVoiceFromEnvOrDefault() {
  // OpenAI TTS voices (common): alloy, echo, fable, onyx, nova, shimmer
  const v = (process.env.OPENAI_TTS_VOICE || "").trim().toLowerCase();
  if (v) return v;

  // default: nova tends to feel more human than alloy for many scripts
  return "nova";
}

/**
 * Generates a voiceover MP3 for a pipeline render job and uploads it to Storage.
 * Returns a signed URL (string) or null (if cannot be generated).
 */
export async function generateVoiceoverForJob(jobId: string): Promise<string | null> {
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

  const lang = String(script.language || "").trim() || undefined;

  const text = String(script.content || "").trim();
  if (!text) throw new Error("Script is empty (nothing to synthesize).");

  // ✅ Prepare more natural input
  const ttsText = buildVoiceDirection(lang) + normalizeForTTS(text, lang);

  // 3) mark step processing (best-effort; if row missing, fail loudly so we fix seed)
  const now = new Date().toISOString();
  const { error: stepStartErr } = await supabase
    .from("video_render_steps")
    .update({
      status: "processing",
      started_at: now,
      progress: 5,
      updated_at: now,
      error_message: null,
    } as any)
    .eq("job_id", jobId)
    .eq("step", "voiceover");

  if (stepStartErr) throw new Error(`voiceover_step_update_failed: ${stepStartErr.message}`);

  // 4) generate TTS
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  const voice = pickVoiceFromEnvOrDefault();

  const speech = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice,
    input: ttsText,
  });

  const buffer = Buffer.from(await speech.arrayBuffer());
  if (!buffer?.length) throw new Error("TTS returned empty audio buffer.");

  // 5) upload to storage
  const bucket = "renders";
  const path = `voiceovers/${jobId}.mp3`;

  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, buffer, {
    contentType: "audio/mpeg",
    upsert: true,
    cacheControl: "3600",
  });

  if (uploadError) throw new Error(`storage_upload_failed: ${uploadError.message}`);

  // 6) signed url
  const { data: signed, error: signedErr } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60 * 24 * 7);

  if (signedErr) throw new Error(`signed_url_failed: ${signedErr.message}`);

  const signedUrl = signed?.signedUrl ?? null;

  // 7) create asset
  const { error: assetErr } = await supabase.from("video_assets").insert(
    {
      job_id: jobId,
      asset_type: "audio_voice",
      provider: "openai",
      status: "completed",
      storage_bucket: bucket,
      storage_path: path,
      public_url: signedUrl,
      meta: {
        projectRef,
        usedUrl,
        tts: {
          model: "gpt-4o-mini-tts",
          voice,
          language: lang ?? null,
        },
      },
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

  return signedUrl;
}