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

function normalizeText(v: any, max = 500) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function normalizeGender(v: any): "male" | "female" | "unknown" {
  const s = String(v || "").trim().toLowerCase();
  if (s === "male" || s === "man" || s === "m") return "male";
  if (s === "female" || s === "woman" || s === "f") return "female";
  return "unknown";
}

/**
 * Heuristic language detect (lightweight).
 */
function detectLang(scriptLanguage: any, text: string): string {
  const raw = String(scriptLanguage || "").trim().toLowerCase();
  if (raw) {
    if (raw.startsWith("ro")) return "ro";
    if (raw.startsWith("en")) return "en";
    if (raw.startsWith("fr")) return "fr";
    if (raw.startsWith("es")) return "es";
    if (raw.startsWith("de")) return "de";
    if (raw.startsWith("it")) return "it";
    if (raw.startsWith("pt")) return "pt";
    if (raw.startsWith("nl")) return "nl";
    return raw.slice(0, 8);
  }

  if (/[ăâîșşţț]/i.test(text)) return "ro";
  return "en";
}

function getUseCaseFromData(presenter: AnyRow | null, tone: AnyRow | null) {
  const fromPresenter = normalizeText(presenter?.use_case, 80);
  if (fromPresenter) return fromPresenter;

  const fromTone = normalizeText(tone?.useCase, 80);
  if (fromTone) return fromTone;

  return "business_spokesperson";
}

function getVoiceStyleFromData(
  presenterContext: AnyRow | null,
  tone: AnyRow | null,
  useCase: string
) {
  const explicitA = normalizeText(presenterContext?.voiceStyle, 80);
  if (explicitA) return explicitA;

  const explicitB = normalizeText(tone?.voiceStyle, 80);
  if (explicitB) return explicitB;

  switch (useCase) {
    case "sales_outreach":
      return "energetic";
    case "founder_ceo":
      return "authoritative";
    case "product_explainer":
      return "clear";
    case "business_spokesperson":
    default:
      return "premium";
  }
}

function getDeliveryFromData(
  presenterContext: AnyRow | null,
  tone: AnyRow | null,
  voiceStyle: string
) {
  const direct =
    normalizeText(presenterContext?.videoDirection?.delivery, 80) ||
    normalizeText(tone?.videoDirection?.delivery, 80) ||
    normalizeText(presenterContext?.delivery, 80) ||
    normalizeText(tone?.delivery, 80);

  if (direct) return direct.toLowerCase();

  switch (voiceStyle) {
    case "energetic":
      return "energetic";
    case "authoritative":
      return "executive";
    case "clear":
      return "clear";
    case "premium":
    default:
      return "calm";
  }
}

function stripMetaAndNormalizeForTts(input: string): string {
  let t = String(input || "");

  t = t.replace(/\r\n/g, "\n");

  const labelLine =
    /^(?:\s*)(?:scene\s*\/\s*context|context|location|industry\s*\/\s*domain|industry|domain|audience|tone|energy|communication\s*style|style|gender|age\s*range|limbă|limba|ton|energie|stil|audien[țt]ă|domeniu|industrie|loca[țt]ie|voice\s*delivery\s*style|use\s*case|video\s*direction|shot|delivery|movement|background|current\s*direction)\s*[:\-].*$/i;

  const lines = t.split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    const l = line.trim();
    if (!l) {
      kept.push("");
      continue;
    }

    if (labelLine.test(l)) continue;

    if (
      /^(?:premium|friendly|authoritative|strategic|cinematic|ultra[-\s]?minimal|calm|executive|charismatic|dominant|energetic|clear)(?:\s*,\s*(?:premium|friendly|authoritative|strategic|cinematic|ultra[-\s]?minimal|calm|executive|charismatic|dominant|energetic|clear))*$/i.test(
        l
      )
    ) {
      continue;
    }

    if (/^write your script/i.test(l)) continue;
    if (/^script\s*\(preview\)/i.test(l)) continue;

    kept.push(line);
  }

  t = kept.join("\n");

  t = t
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+\|\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");

  t = t
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (t.length > 0) {
    const firstPara = t.split("\n\n")[0] || "";
    if (firstPara.includes(":") && firstPara.length < 220) {
      const kvish = firstPara.split("\n").every((ln) => ln.includes(":"));
      if (kvish) {
        t = t.split("\n\n").slice(1).join("\n\n").trim();
      }
    }
  }

  if (t && !/[.!?…]\s*$/.test(t)) t += ".";

  return t;
}

function shapeCadenceForTts(
  rawText: string,
  opts: {
    lang: string;
    delivery: string;
    voiceStyle: string;
    useCase: string;
  }
) {
  let t = rawText;

  t = t.replace(/\s+/g, " ").trim();

  t = t
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*;\s*/g, ". ")
    .replace(/\s*:\s*/g, ". ")
    .replace(/\s*\.\s*/g, ". ")
    .replace(/\s*\?\s*/g, "? ")
    .replace(/\s*!\s*/g, "! ")
    .replace(/\.{2,}/g, ".")
    .trim();

  const delivery = opts.delivery.toLowerCase();
  const voiceStyle = opts.voiceStyle.toLowerCase();

  if (
    delivery === "calm" ||
    delivery === "executive" ||
    voiceStyle === "premium" ||
    voiceStyle === "authoritative"
  ) {
    t = t
      .replace(/,\s+(și|iar|dar|însă)\s+/gi, ". $1 ")
      .replace(/,\s+(and|but|while|yet)\s+/gi, ". $1 ");
  }

  if (delivery === "clear" || voiceStyle === "clear") {
    t = t.replace(/,\s+/g, ". ").replace(/\s{2,}/g, " ").trim();
  }

  if (delivery === "energetic" || voiceStyle === "energetic") {
    t = t.replace(/,\s+/g, ", ").replace(/\. ([A-ZĂÂÎȘȚ])/g, ". $1").trim();
  }

  if (
    delivery === "calm" ||
    delivery === "executive" ||
    voiceStyle === "premium" ||
    voiceStyle === "authoritative"
  ) {
    const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (parts.length >= 4) {
      const grouped: string[] = [];
      for (let i = 0; i < parts.length; i += 2) {
        grouped.push(parts.slice(i, i + 2).join(" "));
      }
      t = grouped.join("\n\n");
    }
  }

  if (t && !/[.!?…]\s*$/.test(t)) t += ".";

  return t.trim();
}

function pickVoiceByGenderAndStyle(opts: {
  lang: string;
  gender: "male" | "female" | "unknown";
  delivery: string;
  voiceStyle: string;
}) {
  const override = (process.env.VOICEOVER_VOICE || "").trim();
  if (override) return override;

  const lang = opts.lang.toLowerCase();
  const gender = opts.gender;
  const d = opts.delivery.toLowerCase();
  const v = opts.voiceStyle.toLowerCase();

  // female leaning
  if (gender === "female") {
    if (lang === "ro") {
      if (d === "energetic" || v === "energetic") return "shimmer";
      if (d === "clear" || v === "clear") return "marin";
      if (d === "executive" || v === "authoritative") return "alloy";
      return "alloy";
    }

    if (lang === "en") {
      if (d === "energetic" || v === "energetic") return "shimmer";
      if (d === "clear" || v === "clear") return "alloy";
      if (d === "executive" || v === "authoritative") return "alloy";
      return "alloy";
    }

    if (d === "energetic" || v === "energetic") return "shimmer";
    if (d === "clear" || v === "clear") return "alloy";
    return "alloy";
  }

  // male leaning
  if (gender === "male") {
    if (lang === "ro") {
      if (d === "energetic" || v === "energetic") return "verse";
      if (d === "clear" || v === "clear") return "marin";
      if (d === "executive" || v === "authoritative") return "cedar";
      return "cedar";
    }

    if (lang === "en") {
      if (d === "energetic" || v === "energetic") return "verse";
      if (d === "clear" || v === "clear") return "marin";
      if (d === "executive" || v === "authoritative") return "cedar";
      return "marin";
    }

    if (d === "energetic" || v === "energetic") return "verse";
    if (d === "clear" || v === "clear") return "marin";
    return "cedar";
  }

  // unknown fallback
  if (lang === "ro") {
    if (d === "energetic" || v === "energetic") return "verse";
    if (d === "clear" || v === "clear") return "marin";
    if (d === "executive" || v === "authoritative") return "cedar";
    return "marin";
  }

  if (lang === "en") {
    if (d === "energetic" || v === "energetic") return "shimmer";
    if (d === "clear" || v === "clear") return "marin";
    if (d === "executive" || v === "authoritative") return "cedar";
    return "marin";
  }

  if (d === "energetic" || v === "energetic") return "shimmer";
  if (d === "clear" || v === "clear") return "marin";
  if (d === "executive" || v === "authoritative") return "cedar";
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

  const presenterId = String(job.presenter_id || "");
  if (!presenterId) throw new Error("Job missing presenter_id");

  const { data: scriptRaw, error: scriptErr } = await supabase
    .from("presenter_scripts")
    .select("content, language, tone")
    .eq("id", scriptId)
    .maybeSingle();

  if (scriptErr) throw new Error(`script_fetch_failed: ${scriptErr.message}`);
  const script = scriptRaw as AnyRow | null;
  if (!script) throw new Error("Script not found");

  const { data: presenterRaw, error: presenterErr } = await supabase
    .from("presenters")
    .select("id,name,gender,context,use_case")
    .eq("id", presenterId)
    .maybeSingle();

  if (presenterErr) throw new Error(`presenter_fetch_failed: ${presenterErr.message}`);
  const presenter = presenterRaw as AnyRow | null;
  if (!presenter) throw new Error("Presenter not found");

  const rawText = String(script.content || "").trim();
  if (!rawText) throw new Error("Script is empty (nothing to synthesize).");

  const lang = detectLang(script.language, rawText);
  const tone = script?.tone && typeof script.tone === "object" ? (script.tone as AnyRow) : {};
  const presenterContext =
    presenter?.context && typeof presenter.context === "object"
      ? (presenter.context as AnyRow)
      : {};

  const presenterGender = normalizeGender(presenter?.gender);
  const useCase = getUseCaseFromData(presenter, tone);
  const voiceStyle = getVoiceStyleFromData(presenterContext, tone, useCase);
  const delivery = getDeliveryFromData(presenterContext, tone, voiceStyle);

  const voice = pickVoiceByGenderAndStyle({
    lang,
    gender: presenterGender,
    delivery,
    voiceStyle,
  });

  const cleanedText = stripMetaAndNormalizeForTts(rawText);
  if (!cleanedText) {
    throw new Error("After cleanup, script became empty (check meta stripping rules).");
  }

  const text = shapeCadenceForTts(cleanedText, {
    lang,
    delivery,
    voiceStyle,
    useCase,
  });

  if (!text) {
    throw new Error("After cadence shaping, script became empty.");
  }

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

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  const speech = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice,
    input: text,
  });

  const buffer = Buffer.from(await speech.arrayBuffer());
  if (!buffer?.length) throw new Error("TTS returned empty audio buffer.");

  const bucket = "renders";
  const path = `voiceovers/${jobId}.mp3`;

  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, buffer, {
    contentType: "audio/mpeg",
    upsert: true,
    cacheControl: "3600",
  });

  if (uploadError) throw new Error(`storage_upload_failed: ${uploadError.message}`);

  const { data: signed, error: signedErr } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60 * 24 * 7);

  if (signedErr) throw new Error(`signed_url_failed: ${signedErr.message}`);

  const signedUrl = signed?.signedUrl ?? null;

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
        gender: presenterGender,
        voiceStyle,
        delivery,
        useCase,
        cleaned: true,
        presenterName: normalizeText(presenter?.name, 120) || null,
      },
    } as any
  );

  if (assetErr) throw new Error(`asset_insert_failed: ${assetErr.message}`);

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