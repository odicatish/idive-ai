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

/**
 * Heuristic language detect (lightweight).
 * - Prefer script.language if present.
 */
function detectLang(scriptLanguage: any, text: string): string {
  const raw = String(scriptLanguage || "").trim().toLowerCase();
  if (raw) {
    // normalize common forms
    if (raw.startsWith("ro")) return "ro";
    if (raw.startsWith("en")) return "en";
    if (raw.startsWith("fr")) return "fr";
    if (raw.startsWith("es")) return "es";
    if (raw.startsWith("de")) return "de";
    if (raw.startsWith("it")) return "it";
    if (raw.startsWith("pt")) return "pt";
    if (raw.startsWith("nl")) return "nl";
    // otherwise keep short
    return raw.slice(0, 8);
  }

  // Romanian diacritics heuristic
  if (/[ăâîșţț]/i.test(text)) return "ro";

  // fallback
  return "en";
}

/**
 * Remove "meta" lines that your UI might prepend/append:
 * - tone / industry / audience / location / style etc.
 * - headings like "Scene / Context"
 * - bracket-like labels
 *
 * Goal: TTS should speak ONLY the actual script.
 */
function stripMetaAndNormalizeForTts(input: string): string {
  let t = String(input || "");

  // normalize newlines
  t = t.replace(/\r\n/g, "\n");

  // Remove obvious UI section headings (EN/RO) and label lines
  // We remove lines like: "TONE: premium", "Industry / Domain: business", etc.
  const labelLine = /^(?:\s*)(?:scene\s*\/\s*context|context|location|industry\s*\/\s*domain|industry|domain|audience|tone|energy|communication\s*style|style|gender|age\s*range|limbă|limba|ton|energie|stil|audien[țt]ă|domeniu|industrie|loca[țt]ie)\s*[:\-].*$/i;

  const lines = t.split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    const l = line.trim();
    if (!l) {
      kept.push("");
      continue;
    }

    // drop label lines
    if (labelLine.test(l)) continue;

    // drop lines that are just tags like: "premium, friendly, authoritative"
    if (/^(?:premium|friendly|authoritative|strategic|cinematic|ultra[-\s]?minimal|calm|executive|charismatic|dominant)(?:\s*,\s*(?:premium|friendly|authoritative|strategic|cinematic|ultra[-\s]?minimal|calm|executive|charismatic|dominant))*$/i.test(l)) {
      continue;
    }

    // drop UI hints / placeholders
    if (/^write your script/i.test(l)) continue;
    if (/^script\s*\(preview\)/i.test(l)) continue;

    kept.push(line);
  }

  t = kept.join("\n");

  // Remove markdown noise that can make it sound robotic
  t = t
    .replace(/```[\s\S]*?```/g, "")      // code blocks
    .replace(/`([^`]+)`/g, "$1")         // inline code
    .replace(/^#{1,6}\s+/gm, "")         // headings
    .replace(/^\s*[-*•]\s+/gm, "")       // bullets
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1"); // markdown links

  // Collapse excessive whitespace but keep paragraph pauses
  t = t
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // If it starts with a meta paragraph (common), try to cut until first “real” sentence.
  // (very conservative: only if we see ":", and looks like config)
  if (t.length > 0) {
    const firstPara = t.split("\n\n")[0] || "";
    if (firstPara.includes(":") && firstPara.length < 220) {
      // if first paragraph is mostly key:value-ish, drop it
      const kvish = firstPara.split("\n").every((ln) => ln.includes(":"));
      if (kvish) {
        t = t.split("\n\n").slice(1).join("\n\n").trim();
      }
    }
  }

  // Ensure ending punctuation helps cadence
  if (t && !/[.!?…]\s*$/.test(t)) t += ".";

  return t;
}

/**
 * Voice selection
 * You can override via env:
 * - VOICEOVER_VOICE=marin (or cedar, shimmer, verse, etc.)
 *
 * Voices list includes: alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar. :contentReference[oaicite:1]{index=1}
 */
function pickVoice(lang: string): string {
  const override = (process.env.VOICEOVER_VOICE || "").trim();
  if (override) return override;

  // Simple defaults:
  // - For RO, "cedar" often sounds fuller/less “nasal” than alloy
  // - For EN, "marin" tends to sound more natural
  if (lang === "ro") return "cedar";
  if (lang === "en") return "marin";

  // fallback
  return "marin";
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

  const rawText = String(script.content || "").trim();
  if (!rawText) throw new Error("Script is empty (nothing to synthesize).");

  const lang = detectLang(script.language, rawText);
  const voice = pickVoice(lang);

  // ✅ clean text so it does NOT read tone/context labels
  const text = stripMetaAndNormalizeForTts(rawText);
  if (!text) throw new Error("After cleanup, script became empty (check meta stripping rules).");

  // 3) mark step processing
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

  const speech = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice,
    input: text,
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
        lang,
        voice,
        cleaned: true,
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