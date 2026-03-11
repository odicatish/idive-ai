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

function normalizeText(v: any) {
  return typeof v === "string" ? v.trim() : "";
}

function getUseCaseInstruction(useCase: string) {
  switch (useCase) {
    case "sales_outreach":
      return `
USE CASE: SALES OUTREACH VIDEO

Goal:
Create a short persuasive video for prospecting, outreach, or lead generation.

What this should feel like:
- direct
- warm
- credible
- fast value communication

Recommended structure:
1. quick hook
2. identify the pain/problem
3. clear solution/value
4. simple CTA

Duration target:
15–25 seconds spoken.
`.trim();

    case "founder_ceo":
      return `
USE CASE: FOUNDER / CEO MESSAGE

Goal:
Create a leadership-style message that communicates mission, vision, or strategic direction.

What this should feel like:
- executive
- authentic
- calm authority
- trust-building

Recommended structure:
1. founder perspective
2. what matters now
3. vision / mission / belief
4. invitation to move forward

Duration target:
20–35 seconds spoken.
`.trim();

    case "product_explainer":
      return `
USE CASE: PRODUCT EXPLAINER

Goal:
Explain clearly what the product does and why it matters.

What this should feel like:
- clear
- simple
- structured
- easy to follow

Recommended structure:
1. hook
2. problem
3. how it works
4. outcome / benefit
5. CTA when appropriate

Duration target:
25–40 seconds spoken.
`.trim();

    case "business_spokesperson":
    default:
      return `
USE CASE: BUSINESS SPOKESPERSON

Goal:
Represent the company in a polished, premium, professional way.

What this should feel like:
- trustworthy
- polished
- premium
- brand-safe

Recommended structure:
1. strong hook
2. what the company does
3. why it matters
4. CTA

Duration target:
20–30 seconds spoken.
`.trim();
  }
}

function getVoiceStyle(useCase: string, context: Record<string, any>) {
  const explicit = normalizeText(context?.voiceStyle);
  if (explicit) return explicit;

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

function buildVideoDirection(context: Record<string, any>) {
  const vd =
    context?.videoDirection && typeof context.videoDirection === "object"
      ? context.videoDirection
      : {};

  const shot = normalizeText(vd?.shot || context?.shot);
  const delivery = normalizeText(vd?.delivery || context?.delivery);
  const movement = normalizeText(vd?.movement || context?.movement);
  const background = normalizeText(vd?.background || context?.background);
  const currentDirection = normalizeText(vd?.currentDirection || context?.currentDirection);

  const parts = [
    shot ? `- Shot: ${shot}` : "",
    delivery ? `- Delivery: ${delivery}` : "",
    movement ? `- Movement: ${movement}` : "",
    background ? `- Background: ${background}` : "",
    currentDirection ? `- Current direction: ${currentDirection}` : "",
  ].filter(Boolean);

  return {
    hasAny: parts.length > 0,
    text: parts.join("\n"),
  };
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
    .select("id,user_id,name,context,use_case")
    .eq("id", presenterId)
    .maybeSingle();

  if (pErr) return jsonError(500, "presenter_load_failed", pErr.message);
  if (!presenter || presenter.user_id !== auth.user.id) return jsonError(404, "not_found");

  const { data: script, error: sErr } = await supabase
    .from("presenter_scripts")
    .select("id,presenter_id,content,version,language,updated_at,tone")
    .eq("presenter_id", presenterId)
    .maybeSingle();

  if (sErr) return jsonError(500, "script_load_failed", sErr.message);
  if (!script) return jsonError(404, "script_missing");

  const presenterCtx =
    presenter?.context && typeof presenter.context === "object" ? presenter.context : {};

  const scriptTone =
    script?.tone && typeof script.tone === "object" ? (script.tone as Record<string, any>) : {};

  const merged = {
    ...scriptTone,
    ...presenterCtx,
    ...uiContext,
  };

  const useCase = normalizeText((presenter as any)?.use_case) || normalizeText(merged?.useCase) || "business_spokesperson";
  const voiceStyle = getVoiceStyle(useCase, merged);

  const tone = normalizeText(merged?.tone) || "premium";
  const visual = normalizeText(merged?.visual) || "apple-cinematic";
  const location = normalizeText(merged?.location);
  const domain = normalizeText(merged?.domain);
  const audience = normalizeText(merged?.audience);
  const notes = normalizeText(merged?.notes);

  const videoDirection = buildVideoDirection(merged);

  const draftForAI = incomingContent.trim().length ? incomingContent : String(script.content ?? "");
  const openai = openaiServer as unknown as OpenAI;

  let languageTag = "en";
  if (requestedLanguage !== "auto") {
    languageTag = requestedLanguage || "en";
  } else {
    const detectText = [
      draftForAI,
      notes,
      audience,
      domain,
      useCase,
      voiceStyle,
      videoDirection.text,
    ]
      .filter(Boolean)
      .join("\n\n")
      .trim();

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
    "You are a senior copywriter, creative director, and voiceover director for AI video presenters. " +
    "Write natural, premium, spoken marketing copy that feels believable on camera. " +
    "Avoid clichés, robotic patterns, filler, and generic ad language. " +
    "Return ONLY valid JSON per the schema.";

  const user = `
Return ONLY valid JSON matching the provided schema.

You are rewriting or generating spoken video script copy for an AI presenter.

Hard rules:
- Output language MUST be: ${targetLanguageName} (tag: ${languageTag})
- If the current draft already has a clear language, preserve that language unless explicitly overridden
- Length: 80–160 words unless the use case naturally needs slightly shorter copy
- No bullet points
- No headings
- No emojis
- No weird symbols
- Hook: max 2 sentences
- CTA: exactly 1 sentence
- Body: short spoken sentences, easy to say out loud
- Avoid clichés, filler, and fake hype
- Make it sound spoken on camera, not written for a brochure

Presenter / brand context:
- Presenter name: ${normalizeText((presenter as any)?.name) || "not specified"}
- Use case: ${useCase}
- Voice delivery style: ${voiceStyle}
- Tone: ${tone}
- Visual vibe: ${visual}
- Location: ${location || "not specified"}
- Industry/Domain: ${domain || "not specified"}
- Audience: ${audience || "not specified"}
- Notes: ${notes || "none"}

Use case direction:
${getUseCaseInstruction(useCase)}

Voice style rules:
- premium = polished, calm, elegant
- energetic = sharper, faster, more direct
- authoritative = composed, executive, confident
- clear = simple, structured, easy to follow

${
  videoDirection.hasAny
    ? `Video direction:
${videoDirection.text}

Interpret video direction as on-camera delivery guidance.
It should influence pacing, presence, and wording subtly.
`
    : ""
}

Current draft:
${draftForAI}

Output requirements:
- hook should feel strong and spoken
- body should be natural and camera-friendly
- cta should feel appropriate for the use case
- finalText must read like one clean final script ready for voiceover
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
          name: "ai_script_anylang_v3",
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

  const { error: preErr } = await supabase
    .from("presenter_script_versions")
    .upsert(
      {
        script_id: script.id,
        version: prevVersion,
        source: "snapshot",
        meta: {
          reason,
          phase: "pre",
          useCase,
          voiceStyle,
        },
        content: String(script.content ?? ""),
        created_by: auth.user.id,
      },
      { onConflict: "script_id,version", ignoreDuplicates: true }
    );

  if (preErr) return jsonError(500, "version_presnapshot_failed", preErr.message);

  const nextTone = {
    ...(scriptTone ?? {}),
    useCase,
    voiceStyle,
    industry: domain || scriptTone?.industry || null,
    tone: tone || scriptTone?.tone || null,
    visual: visual || scriptTone?.visual || null,
    audience: audience || scriptTone?.audience || null,
    location: location || scriptTone?.location || null,
    videoDirection: videoDirection.hasAny ? {
      shot: normalizeText(merged?.videoDirection?.shot || merged?.shot),
      delivery: normalizeText(merged?.videoDirection?.delivery || merged?.delivery),
      movement: normalizeText(merged?.videoDirection?.movement || merged?.movement),
      background: normalizeText(merged?.videoDirection?.background || merged?.background),
      currentDirection: normalizeText(merged?.videoDirection?.currentDirection || merged?.currentDirection),
    } : scriptTone?.videoDirection ?? null,
  };

  const { error: upErr } = await supabase
    .from("presenter_scripts")
    .update({
      content: finalText,
      version: nextVersion,
      updated_at: now,
      updated_by: auth.user.id,
      language: languageTag,
      tone: nextTone,
    } as any)
    .eq("id", script.id);

  if (upErr) return jsonError(500, "script_update_failed", upErr.message);

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
          useCase,
          voiceStyle,
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