// app/api/generate-script/route.ts
import OpenAI from "openai";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const runtime = "nodejs";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const BUCKET = "presenters";

function randomId() {
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function normalizeStr(v: any, max = 220) {
  if (typeof v !== "string") return "";
  const s = v.trim();
  if (!s) return "";
  return s.slice(0, max);
}

type PresenterJson = {
  gender: "male" | "female";
  name: string;
  title: string;
  bio: string;
  script: string;
  appearance: string;
};

const presenterSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    gender: { type: "string", enum: ["male", "female"] },
    name: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    bio: { type: "string", minLength: 1 },
    script: { type: "string", minLength: 1 },
    appearance: { type: "string", minLength: 10 },
  },
  required: ["gender", "name", "title", "bio", "script", "appearance"],
} as const;

async function getSignedUrl(path: string) {
  const signed = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  if (signed.error) throw new Error(`Signed URL failed: ${signed.error.message}`);
  if (!signed.data?.signedUrl) throw new Error("Signed URL missing signedUrl");
  return signed.data.signedUrl;
}

async function getUserIdFromSession(): Promise<string | null> {
  try {
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => {
                cookieStore.set(name, value, options);
              });
            } catch {}
          },
        },
      }
    );

    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user?.id) return null;
    return data.user.id;
  } catch {
    return null;
  }
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
- clear value fast

Recommended structure:
1. fast hook
2. identify a real problem
3. short value proposition
4. invitation to talk / book demo / learn more

Duration target:
15–25 seconds spoken.

CTA style:
light, direct, action-oriented.
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
- high trust

Recommended structure:
1. founder perspective
2. what matters now
3. mission / direction
4. invitation to believe, join, or move forward

Duration target:
20–35 seconds spoken.

Tone:
human, confident, visionary, not corporate fluff.
`.trim();

    case "product_explainer":
      return `
USE CASE: PRODUCT EXPLAINER

Goal:
Explain clearly what the product does and why it matters.

What this should feel like:
- simple
- sharp
- easy to follow
- benefit-first

Recommended structure:
1. hook
2. problem
3. how it works
4. result / benefit
5. CTA

Duration target:
25–40 seconds spoken.

Tone:
clear and instructive, not overly salesy.
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
- modern
- premium brand voice

Recommended structure:
1. strong hook
2. what the company does
3. why it matters
4. CTA

Duration target:
20–30 seconds spoken.

Tone:
brand-safe, confident, concise.
`.trim();
  }
}

function getVoiceStyle(useCase: string) {
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

export async function POST(req: Request) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const userId = await getUserIdFromSession();
    if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

    const useCase =
      typeof body.useCase === "string" && body.useCase.trim()
        ? body.useCase.trim()
        : "business_spokesperson";

    const userPrompt =
      typeof body.prompt === "string" && body.prompt.trim().length > 0
        ? body.prompt.trim()
        : null;

    const ctxIn = body?.context && typeof body.context === "object" ? body.context : {};

    const genderIn =
      typeof body.gender === "string" && body.gender.trim()
        ? body.gender.trim()
        : "any";

    const age =
      typeof body.age === "string" && body.age.trim()
        ? body.age.trim()
        : "30-45";

    const industry =
      typeof body.industry === "string" && body.industry.trim()
        ? body.industry.trim()
        : "business";

    const energy =
      typeof body.energy === "string" && body.energy.trim()
        ? body.energy.trim()
        : "executive";

    const style =
      typeof body.style === "string" && body.style.trim()
        ? body.style.trim()
        : "authoritative";

    const voiceStyle = getVoiceStyle(useCase);

    const context = {
      location: normalizeStr(ctxIn.location, 160),
      domain: normalizeStr(ctxIn.domain, 120) || normalizeStr(body.industry, 120),
      audience: normalizeStr(ctxIn.audience, 140),
      tone: normalizeStr(ctxIn.tone, 40) || "premium",
      visual: normalizeStr(ctxIn.visual, 60) || "apple-cinematic",
      notes: normalizeStr(ctxIn.notes, 400),
      voiceStyle,
      useCase,
    };

    const genderRule =
      genderIn === "any"
        ? `Choose ONE gender: "male" or "female" and set it in the JSON field "gender".`
        : `Gender MUST be "${genderIn}".`;

    const useCaseInstruction = getUseCaseInstruction(useCase);

    const contextBlock = `
SCENE / BRAND CONTEXT:
- Location: ${context.location || "not specified"}
- Domain / Industry: ${context.domain || industry}
- Audience: ${context.audience || "not specified"}
- Tone: ${context.tone}
- Visual vibe: ${context.visual}
- Voice delivery style: ${voiceStyle}
- Notes: ${context.notes || "none"}

INTERPRETATION RULE:
Use this context as creative direction, not as metadata.
It should influence the script naturally.
The voice delivery style should shape rhythm, clarity, and attitude.
`.trim();

    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      input: `
Create a hyper-realistic AI presenter in VALID JSON.

${genderRule}

BASE PROFILE:
- Age range: ${age}
- Industry: ${context.domain || industry}
- Energy: ${energy}
- Style: ${style}
- Voice delivery style: ${voiceStyle}

${useCaseInstruction}

${contextBlock}

PRESENTER RULES:
- realistic first + last name
- name must match gender
- title must match the use case
- bio must sound credible and professional
- appearance should describe a premium, believable spokesperson suitable for the chosen use case
- do not reference celebrities or real people

SCRIPT RULES:
- language: Romanian unless the user prompt clearly requests another language
- natural spoken language
- not robotic
- strong first sentence
- persuasive but not exaggerated
- avoid clichés and fake hype
- make it feel spoken on camera, not written for a brochure
- short clean sentences
- clear spoken rhythm
- target duration based on the chosen use case
- match the requested voice delivery style:
  - premium = polished, calm, elegant
  - energetic = sharper, faster, more direct
  - authoritative = composed, executive, confident
  - clear = simple, structured, easy to follow
- include CTA only when appropriate for that use case

${userPrompt ? `USER PROMPT:\n${userPrompt}` : ""}

Return ONLY the JSON object.
`.trim(),
      text: {
        format: {
          type: "json_schema",
          name: "presenter",
          strict: true,
          schema: presenterSchema,
        },
      },
    });

    const jsonText = response.output_text?.trim();
    if (!jsonText) {
      return Response.json({ error: "Text generation failed" }, { status: 500 });
    }

    let presenter: PresenterJson;

    try {
      presenter = JSON.parse(jsonText);
    } catch {
      return Response.json({ error: "JSON parse failed", raw: jsonText }, { status: 500 });
    }

    const imagePrompt = `
Ultra realistic cinematic portrait.

GENDER: ${presenter.gender}
AGE RANGE: ${age}

IDENTITY / APPEARANCE:
${presenter.appearance}

USE CASE:
${useCase}

BRAND CONTEXT:
- Domain: ${context.domain || industry}
- Tone: ${context.tone}
- Visual vibe: ${context.visual}
- Location: ${context.location || "not specified"}

IMPORTANT:
- premium spokesperson look
- believable real human
- not resembling any real public person
- professional commercial portrait
- camera-ready face and wardrobe
- natural skin texture
- subtle imperfections
- elegant lighting

Shot on 85mm lens
studio lighting
extreme detail
`.trim();

    const img = await openai.images.generate({
      model: "gpt-image-1",
      prompt: imagePrompt,
      size: "1024x1536",
    });

    const b64 = img.data?.[0]?.b64_json;
    if (!b64) {
      return Response.json({ error: "Image generation failed" }, { status: 500 });
    }

    const ins = await supabaseAdmin
      .from("presenters")
      .insert({
        user_id: userId,
        name: presenter.name,
        title: presenter.title,
        bio: presenter.bio,
        script: presenter.script,
        appearance: presenter.appearance,
        prompt: userPrompt,
        context,
        use_case: useCase,
        gender: presenter.gender,
        age,
        industry: context.domain || industry,
        energy,
        style,
      })
      .select("id")
      .single();

    if (ins.error) {
      return Response.json({ error: ins.error.message }, { status: 500 });
    }

    const presenterId = ins.data.id;

    const bytes = Buffer.from(b64, "base64");
    const filePath = `${presenterId}/${randomId()}.png`;

    const upload = await supabaseAdmin.storage.from(BUCKET).upload(filePath, bytes, {
      contentType: "image/png",
      upsert: false,
    });

    if (upload.error) {
      return Response.json({ error: upload.error.message }, { status: 500 });
    }

    await supabaseAdmin
      .from("presenters")
      .update({ image_path: filePath })
      .eq("id", presenterId);

    const scriptIns = await supabaseAdmin
      .from("presenter_scripts")
      .insert({
        presenter_id: presenterId,
        content: presenter.script ?? "",
        language: "ro",
        version: 1,
        created_by: userId,
        updated_by: userId,
        tone: {
          industry: context.domain || industry,
          energy,
          style,
          useCase,
          voiceStyle,
          audience: context.audience || null,
          tone: context.tone || null,
          visual: context.visual || null,
          location: context.location || null,
        },
      })
      .select("id,version,content")
      .single();

    if (!scriptIns.error && scriptIns.data?.id) {
      await supabaseAdmin
        .from("presenter_script_versions")
        .upsert(
          {
            script_id: scriptIns.data.id,
            content: scriptIns.data.content,
            version: scriptIns.data.version,
            source: "snapshot",
            meta: { reason: "generate-script", useCase, voiceStyle },
            created_by: userId,
          },
          { onConflict: "script_id,version", ignoreDuplicates: true }
        );
    }

    const signedUrl = await getSignedUrl(filePath);

    return Response.json({
      id: presenterId,
      ...presenter,
      image_path: filePath,
      image: signedUrl,
      prompt: userPrompt,
      context,
      useCase,
      voiceStyle,
    });
  } catch (error: any) {
    console.error("AI ROUTE ERROR:", error);
    return Response.json(
      { error: "Failed to generate presenter", details: String(error?.message || error) },
      { status: 500 }
    );
  }
}