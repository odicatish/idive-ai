import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { openaiServer } from "@/lib/openai/client";
import type OpenAI from "openai";

export const runtime = "nodejs";

type RouteParams = { id: string } | Promise<{ id: string }>;

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

Primary goal:
Create a short outbound video that earns attention fast and makes the next step feel easy.

What the script must achieve:
- sound relevant to a potential buyer quickly
- show that we understand a real business pain
- make the value feel concrete, not vague
- end with a low-friction CTA

What this should feel like:
- direct
- warm
- credible
- commercially sharp
- concise

Recommended flow:
1. pattern-interrupt hook
2. pain / missed opportunity
3. practical value or result
4. very simple next step

CTA style:
- low pressure
- easy to say yes to
- examples: book a demo, take a look, see how it works, have a quick conversation

Avoid:
- fake personalization
- buzzwords
- long setup
- sounding like a mass cold email
- aggressive closing language

Duration target:
15–25 seconds spoken.
`.trim();

    case "founder_ceo":
      return `
USE CASE: FOUNDER / CEO MESSAGE

Primary goal:
Create a leadership message that builds trust, clarity, and belief in the company direction.

What the script must achieve:
- sound like a real founder or executive speaking
- communicate conviction without sounding promotional
- make the audience understand what matters now
- leave a strong sense of direction or commitment

What this should feel like:
- executive
- authentic
- calm authority
- trust-building
- human

Recommended flow:
1. grounded opening from leadership perspective
2. what is changing or what matters now
3. company belief, mission, or direction
4. invitation to move forward together

CTA style:
- measured
- confidence-building
- aligned with trust, not hard sell

Avoid:
- exaggerated hype
- cheesy inspiration
- ad-like phrasing
- empty mission statements
- generic corporate jargon

Duration target:
20–35 seconds spoken.
`.trim();

    case "product_explainer":
      return `
USE CASE: PRODUCT EXPLAINER

Primary goal:
Explain clearly what the product does, how it helps, and why the viewer should care.

What the script must achieve:
- make the product understandable fast
- connect the product to a real problem
- explain the value in plain language
- make the result or outcome easy to picture

What this should feel like:
- clear
- structured
- practical
- easy to follow
- useful

Recommended flow:
1. sharp hook
2. problem or friction
3. what the product does
4. how it helps or what changes
5. CTA when appropriate

CTA style:
- focused on seeing the product or understanding it better
- examples: see it in action, explore how it works, try it, watch a demo

Avoid:
- feature dumping
- technical overload
- vague claims
- long background context
- complicated sentence structure

Duration target:
25–40 seconds spoken.
`.trim();

    case "business_spokesperson":
    default:
      return `
USE CASE: BUSINESS SPOKESPERSON

Primary goal:
Represent the company in a polished, premium way that builds trust and makes the offer feel credible.

What the script must achieve:
- position the company clearly
- communicate value in a business-safe way
- feel polished enough for website, landing page, or brand video use
- end with a CTA that supports conversion

What this should feel like:
- trustworthy
- polished
- premium
- brand-safe
- confident

Recommended flow:
1. strong business-relevant hook
2. what the company does
3. why it matters / outcome
4. CTA

CTA style:
- clear
- professional
- conversion-friendly
- not pushy

Avoid:
- generic agency language
- overclaiming
- overexcited ad copy
- empty superlatives
- robotic brand slogans

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

function getLengthRule(useCase: string) {
  switch (useCase) {
    case "sales_outreach":
      return "50–110 words";
    case "founder_ceo":
      return "90–170 words";
    case "product_explainer":
      return "90–170 words";
    case "business_spokesperson":
    default:
      return "80–150 words";
  }
}

function getHookRule(useCase: string) {
  switch (useCase) {
    case "sales_outreach":
      return "The hook must earn attention in the first sentence and should usually be 1 short sentence, maximum 2.";
    case "founder_ceo":
      return "The hook should sound grounded and credible, not dramatic. Maximum 2 sentences.";
    case "product_explainer":
      return "The hook should create clarity fast and frame the product problem. Maximum 2 sentences.";
    case "business_spokesperson":
    default:
      return "The hook should position the company confidently and professionally. Maximum 2 sentences.";
  }
}

function getCtaRule(useCase: string) {
  switch (useCase) {
    case "sales_outreach":
      return "CTA must be exactly 1 sentence and feel low-friction, natural, and easy to accept.";
    case "founder_ceo":
      return "CTA must be exactly 1 sentence and feel measured, confident, and trust-building.";
    case "product_explainer":
      return "CTA must be exactly 1 sentence and should invite the viewer to see, try, or explore the product.";
    case "business_spokesperson":
    default:
      return "CTA must be exactly 1 sentence and should feel professional, clear, and conversion-friendly.";
  }
}

function getUseCaseCommercialGuidance(useCase: string) {
  switch (useCase) {
    case "sales_outreach":
      return `
Commercial intent:
- prioritize relevance over brand storytelling
- make the value tangible quickly
- imply business upside such as more pipeline, faster follow-up, clearer messaging, or better conversion
- the viewer should feel: "this is relevant to me and worth a quick reply"

Preferred body behavior:
- short sentences
- minimal setup
- one main pain
- one clear value angle
- one easy CTA
`.trim();

    case "founder_ceo":
      return `
Commercial intent:
- strengthen trust in leadership, direction, and seriousness
- support credibility, authority, and brand confidence
- the viewer should feel: "this company knows where it is going"

Preferred body behavior:
- perspective-led wording
- strategic clarity
- emotionally controlled language
- no hard sell unless the draft clearly calls for it
`.trim();

    case "product_explainer":
      return `
Commercial intent:
- reduce confusion
- increase understanding
- make the value easy to picture in real use
- the viewer should feel: "now I get it, and I can see why it matters"

Preferred body behavior:
- explain the before and after
- simplify complexity
- connect features to outcomes
- keep the flow logical and easy to speak
`.trim();

    case "business_spokesperson":
    default:
      return `
Commercial intent:
- increase trust
- improve company positioning
- make the business appear credible, premium, and easy to understand
- the viewer should feel: "this company looks professional and worth considering"

Preferred body behavior:
- clear positioning
- concise value framing
- business-safe language
- polished finish
`.trim();
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

export async function POST(req: Request, ctx: { params: RouteParams }) {
  const presenterId = await getPresenterId(req, ctx.params);
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

  const useCase =
    normalizeText((presenter as any)?.use_case) ||
    normalizeText(merged?.useCase) ||
    "business_spokesperson";

  const voiceStyle = getVoiceStyle(useCase, merged);

  const tone = normalizeText(merged?.tone) || "premium";
  const visual = normalizeText(merged?.visual) || "apple-cinematic";
  const location = normalizeText(merged?.location);
  const domain = normalizeText(merged?.domain || merged?.industry);
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

  const system = `
You are a senior SaaS copywriter, creative director, and voiceover director for AI presenter videos.

Your job:
Write spoken video scripts that are commercially useful, clear on camera, and aligned to the use case.

What "good" looks like:
- believable spoken delivery
- sharp business relevance
- clean structure
- strong but natural hook
- clear value framing
- CTA that matches the use case
- premium wording without sounding generic

Always optimize for:
- clarity
- usefulness
- credibility
- conversion intent
- natural voiceover rhythm

Avoid:
- clichés
- fake hype
- robotic phrasing
- generic ad copy
- brochure language
- bloated intros
- vague claims

Return ONLY valid JSON per the schema.
`.trim();

  const user = `
Return ONLY valid JSON matching the provided schema.

You are rewriting or generating spoken video script copy for an AI presenter.

Hard rules:
- Output language MUST be: ${targetLanguageName} (tag: ${languageTag})
- If the current draft already has a clear language, preserve that language unless explicitly overridden
- Total length target: ${getLengthRule(useCase)}
- No bullet points
- No headings
- No emojis
- No weird symbols
- Write for spoken delivery, not for reading on a page
- Short to medium sentences only
- The script should sound natural out loud
- Keep the message focused around one main commercial idea
- Avoid clichés, filler, and fake hype

Hook / body / CTA rules:
- ${getHookRule(useCase)}
- Body should flow naturally from problem or context into value and outcome
- ${getCtaRule(useCase)}
- finalText must read like one clean final script ready for voiceover
- sections.hook + sections.body + sections.cta should align with finalText

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

Commercial guidance:
${getUseCaseCommercialGuidance(useCase)}

Voice style rules:
- premium = polished, calm, elegant, brand-safe
- energetic = sharper, faster, more direct, but still credible
- authoritative = composed, executive, confident, controlled
- clear = simple, structured, practical, easy to follow

${
  videoDirection.hasAny
    ? `Video direction:
${videoDirection.text}

Interpret video direction as on-camera delivery guidance.
Let it influence pacing, emphasis, confidence, and wording subtly.
Do not describe the direction literally inside the script unless the draft clearly requires it.
`
    : ""
}

Current draft:
${draftForAI}

Quality bar:
- The opening should earn attention quickly
- The middle should make the value easy to understand
- The CTA should feel appropriate for the specific use case
- The copy should be commercially useful, not just polished
- The script should feel like something a real company would actually publish

Rewrite or generate the best possible final script now.
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
          name: "ai_script_anylang_v4",
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
  const minChars = useCase === "sales_outreach" ? 50 : 80;

  if (cleaned.length < minChars) {
    return jsonError(422, "ai_output_too_short", {
      gotChars: cleaned.length,
      minChars,
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
    videoDirection: videoDirection.hasAny
      ? {
          shot: normalizeText(merged?.videoDirection?.shot || merged?.shot),
          delivery: normalizeText(merged?.videoDirection?.delivery || merged?.delivery),
          movement: normalizeText(merged?.videoDirection?.movement || merged?.movement),
          background: normalizeText(merged?.videoDirection?.background || merged?.background),
          currentDirection: normalizeText(
            merged?.videoDirection?.currentDirection || merged?.currentDirection
          ),
        }
      : scriptTone?.videoDirection ?? null,
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