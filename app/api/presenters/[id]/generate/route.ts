import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { openaiServer } from "@/lib/openai/client";
import type OpenAI from "openai";

export const runtime = "nodejs";

async function safeJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

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
    const fromUrl = idx >= 0 ? parts[idx + 1] : "";
    return decodeURIComponent(String(fromUrl ?? "")).trim();
  } catch {
    return "";
  }
}

function languageName(tag: string) {
  const t = (tag || "").toLowerCase();
  const map: Record<string, string> = {
    en: "English",
    ro: "Romanian",
    fr: "French",
    de: "German",
    es: "Spanish",
    it: "Italian",
    pt: "Portuguese",
    nl: "Dutch",
    sv: "Swedish",
    no: "Norwegian",
    da: "Danish",
    fi: "Finnish",
    pl: "Polish",
    cs: "Czech",
    hu: "Hungarian",
    tr: "Turkish",
    el: "Greek",
    he: "Hebrew",
    ar: "Arabic",
    hi: "Hindi",
    th: "Thai",
    vi: "Vietnamese",
    id: "Indonesian",
    ms: "Malay",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
    uk: "Ukrainian",
    ru: "Russian",
    bg: "Bulgarian",
    sr: "Serbian",
    hr: "Croatian",
  };
  return map[t] ?? t;
}

async function detectLanguageTag(openai: OpenAI, text: string) {
  const sample = (text ?? "").trim();
  if (!sample) return "en";

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      tag: {
        type: "string",
        enum: [
          "en",
          "ro",
          "fr",
          "de",
          "es",
          "it",
          "pt",
          "nl",
          "sv",
          "no",
          "da",
          "fi",
          "pl",
          "cs",
          "hu",
          "tr",
          "el",
          "he",
          "ar",
          "hi",
          "th",
          "vi",
          "id",
          "ms",
          "ja",
          "ko",
          "zh",
          "uk",
          "ru",
          "bg",
          "sr",
          "hr",
        ],
      },
    },
    required: ["tag"],
  } as const;

  const resp = await openai.responses.create({
    model: process.env.OPENAI_LANG_DETECT_MODEL || "gpt-4o-mini",
    input: [
      {
        role: "system",
        content: "Detect the user's language from the text. Return ONLY JSON that matches the schema.",
      },
      { role: "user", content: sample.slice(0, 1200) },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "lang_detect_v1",
        strict: true,
        schema,
      },
    },
  });

  const raw = (resp.output_text ?? "").trim();
  if (!raw) return "en";

  try {
    const parsed = JSON.parse(raw);
    const tag = String(parsed?.tag ?? "").toLowerCase().trim();
    return tag || "en";
  } catch {
    return "en";
  }
}

export async function POST(req: Request, context: any) {
  const presenterId = getPresenterId(req, context);
  if (!presenterId) return jsonError(400, "invalid_presenter_id");

  const body = await safeJson(req);

  const requestedLanguage =
    typeof body?.language === "string" ? String(body.language).toLowerCase().trim() : "auto";

  const incomingContent = typeof body?.content === "string" ? body.content : "";
  const uiContext: Record<string, any> =
    body?.context && typeof body.context === "object" ? body.context : {};

  const supabase = await supabaseServer();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return jsonError(401, "unauthorized");

  const { data: presenter, error: pErr } = await supabase
    .from("presenters")
    .select("id,user_id,context,name")
    .eq("id", presenterId)
    .maybeSingle();

  if (pErr) return jsonError(500, "presenter_load_failed", pErr.message);
  if (!presenter || presenter.user_id !== auth.user.id) return jsonError(404, "not_found");

  const { data: script, error: sErr } = await supabase
    .from("presenter_scripts")
    .select("id,presenter_id,content,version,language,updated_at")
    .eq("presenter_id", presenterId)
    .maybeSingle();

  if (sErr) return jsonError(500, "script_load_failed", sErr.message);
  if (!script) return jsonError(404, "script_missing");

  const presenterCtx =
    presenter?.context && typeof presenter.context === "object" ? presenter.context : {};
  const merged = { ...presenterCtx, ...uiContext };

  const tone = String(merged?.tone ?? "premium");
  const visual = String(merged?.visual ?? "apple-cinematic");
  const location = String(merged?.location ?? "");
  const domain = String(merged?.domain ?? "");
  const audience = String(merged?.audience ?? "");
  const notes = String(merged?.notes ?? "");

  const draftForAI = incomingContent.trim().length ? incomingContent : String(script.content ?? "");
  const openai = openaiServer as unknown as OpenAI;

  let languageTag = "en";
  if (requestedLanguage !== "auto") {
    languageTag = requestedLanguage || "en";
  } else {
    const detectText = `${draftForAI}\n\n${notes}\n\n${audience}\n\n${domain}`.trim();
    try {
      languageTag = await detectLanguageTag(openai, detectText);
    } catch (e) {
      console.error("[generate] LANG_DETECT_FAILED", e);
      languageTag = "en";
    }
  }

  const targetLanguageName = languageName(languageTag);

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      language: { type: "string", minLength: 2 },
      sections: {
        type: "object",
        additionalProperties: false,
        properties: {
          hook: { type: "string", minLength: 1 },
          body: { type: "string", minLength: 1 },
          cta: { type: "string", minLength: 1 },
        },
        required: ["hook", "body", "cta"],
      },
      finalText: { type: "string", minLength: 1 },
    },
    required: ["language", "sections", "finalText"],
  } as const;

  const system =
    "You are a senior copywriter and voiceover director. " +
    "Write natural, clear, premium, cinematic spoken marketing copy without clichés. " +
    "Return ONLY valid JSON per the schema.";

  const user = `
Return ONLY valid JSON matching the provided schema.

You are writing a spoken script for a video presenter (avatar).
Make it sound natural, confident, and premium — not like a generic ad.

Hard rules:
- Output language MUST be: ${targetLanguageName} (tag: ${languageTag})
- If the current draft is in a language, match that language.
- Length: 80–160 words (roughly 20–30 seconds spoken)
- No bullet points, no headings, no emojis, no weird symbols (like "/" or "*")
- Hook: max 2 sentences
- CTA: exactly 1 sentence
- Body: short spoken sentences, 1–3 lines per paragraph
- Avoid clichés and filler

Context:
- Location: ${location}
- Industry/Domain: ${domain}
- Audience: ${audience}
- Tone: ${tone}
- Visual vibe: ${visual}
- Notes: ${notes}

Current draft:
${draftForAI}
`.trim();

  let jsonText = "";
  try {
    const resp = await openai.responses.create({
      model: process.env.OPENAI_PREMIUM_MODEL || "gpt-4o-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "ai_script_anylang_v2",
          strict: true,
          schema,
        },
      },
    });
    jsonText = resp.output_text?.trim() ?? "";
  } catch (e: any) {
    console.error("[generate] OPENAI_ERROR", e);
    return jsonError(502, "openai_failed", e?.message ?? String(e));
  }

  if (!jsonText) return jsonError(500, "ai_empty_output");

  let ai: any;
  try {
    ai = JSON.parse(jsonText);
  } catch (e: any) {
    return jsonError(500, "ai_invalid_json", { message: e?.message, raw: jsonText });
  }

  const finalText = String(ai?.finalText ?? "").trim();
  if (!finalText) return jsonError(500, "ai_missing_finalText");

  const cleaned = finalText.replace(/\s+/g, " ").trim();
  if (cleaned.length < 80) {
    return jsonError(422, "ai_output_too_short", {
      gotChars: cleaned.length,
      preview: cleaned.slice(0, 120),
    });
  }

  const prevVersion = Number.isFinite(script.version) ? Number(script.version) : 0;
  const nextVersion = prevVersion + 1;
  const now = new Date().toISOString();
  const reason = "generate";

  // ✅ PRE snapshot (no duplicate crashes)
  const { error: preErr } = await supabase
    .from("presenter_script_versions")
    .upsert(
      {
        script_id: script.id,
        version: prevVersion,
        source: "snapshot",
        meta: { reason, phase: "pre" },
        content: String(script.content ?? ""),
        created_by: auth.user.id,
      },
      { onConflict: "script_id,version", ignoreDuplicates: true }
    );

  if (preErr) return jsonError(500, "version_presnapshot_failed", preErr.message);

  const { error: upErr } = await supabase
    .from("presenter_scripts")
    .update({
      content: finalText,
      version: nextVersion,
      updated_at: now,
      updated_by: auth.user.id,
      language: languageTag,
    } as any)
    .eq("id", script.id);

  if (upErr) return jsonError(500, "script_update_failed", upErr.message);

  // ✅ POST snapshot (no duplicate crashes)
  const { error: postErr } = await supabase
    .from("presenter_script_versions")
    .upsert(
      {
        script_id: script.id,
        version: nextVersion,
        source: "snapshot",
        meta: {
          reason,
          phase: "post",
          ai: {
            language: String(ai?.language ?? languageTag),
            sections: ai?.sections ?? null,
          },
        },
        content: finalText,
        created_by: auth.user.id,
      },
      { onConflict: "script_id,version", ignoreDuplicates: true }
    );

  if (postErr) return jsonError(500, "version_postsnapshot_failed", postErr.message);

  return NextResponse.json({
    script: {
      id: script.id,
      presenterId,
      content: finalText,
      language: languageTag,
      version: nextVersion,
      updatedAt: now,
      updatedBy: auth.user.id,
    },
  });
}