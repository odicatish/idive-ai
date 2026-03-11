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

    const useCase = body.useCase || "business_spokesperson";

    const userPrompt =
      typeof body.prompt === "string" && body.prompt.trim().length > 0 ? body.prompt.trim() : null;

    const ctxIn = body?.context && typeof body.context === "object" ? body.context : {};

    const context = {
      location: normalizeStr(ctxIn.location, 160),
      domain: normalizeStr(ctxIn.domain, 120) || normalizeStr(body.industry, 120),
      audience: normalizeStr(ctxIn.audience, 140),
      tone: normalizeStr(ctxIn.tone, 40) || "premium",
      visual: normalizeStr(ctxIn.visual, 60) || "apple-cinematic",
      notes: normalizeStr(ctxIn.notes, 400),
    };

    const genderIn = body.gender || "any";
    const age = body.age || "30-45";
    const industry = body.industry || "business";
    const energy = body.energy || "executive";
    const style = body.style || "authoritative";

    const genderRule =
      genderIn === "any"
        ? `Choose ONE gender: "male" or "female" and set it in the JSON field "gender".`
        : `Gender MUST be "${genderIn}".`;

    // 🔹 use case script behavior
    let useCaseInstruction = "";

    if (useCase === "sales_outreach") {
      useCaseInstruction = `
USE CASE: SALES OUTREACH VIDEO

Goal: convince a potential customer to explore the product.

Structure:
1. personalized style hook
2. short problem statement
3. short solution explanation
4. invitation to book demo

Duration: 15-20 seconds.
CTA: book a demo or learn more.
`;
    }

    if (useCase === "product_explainer") {
      useCaseInstruction = `
USE CASE: PRODUCT EXPLAINER

Goal: clearly explain a product or feature.

Structure:
1. hook
2. what problem it solves
3. how it works
4. benefit

Duration: 25-40 seconds.
CTA: try it today.
`;
    }

    if (useCase === "founder_ceo") {
      useCaseInstruction = `
USE CASE: FOUNDER MESSAGE

Goal: communicate leadership vision.

Structure:
1. founder perspective
2. mission
3. short insight
4. invitation to join

Duration: 25-30 seconds.
Tone: authentic and visionary.
`;
    }

    if (useCase === "business_spokesperson") {
      useCaseInstruction = `
USE CASE: BUSINESS SPOKESPERSON

Goal: represent the company professionally.

Structure:
1. strong hook
2. what the company does
3. key benefit
4. CTA

Duration: 20-30 seconds.
`;
    }

    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      input: `
Create a hyper-realistic AI presenter in JSON.

${genderRule}

Industry: ${context.domain || industry}
Energy: ${energy}
Style: ${style}

${useCaseInstruction}

SCRIPT RULES:
- language: Romanian unless prompt specifies otherwise
- natural spoken language
- not robotic
- strong first sentence
- persuasive but not exaggerated
- no marketing hype words

${userPrompt ? `USER PROMPT:\n${userPrompt}` : ""}

Return ONLY JSON.
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
    } catch (e: any) {
      return Response.json({ error: "JSON parse failed", raw: jsonText }, { status: 500 });
    }

    const imagePrompt = `
Ultra realistic cinematic portrait.

GENDER: ${presenter.gender}
AGE RANGE: ${age}

${presenter.appearance}

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
    if (!b64) return Response.json({ error: "Image generation failed" }, { status: 500 });

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

    await supabaseAdmin.storage.from(BUCKET).upload(filePath, bytes, {
      contentType: "image/png",
    });

    await supabaseAdmin.from("presenters").update({ image_path: filePath }).eq("id", presenterId);

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
        },
      })
      .select("id")
      .single();

    const signedUrl = await getSignedUrl(filePath);

    return Response.json({
      id: presenterId,
      ...presenter,
      image_path: filePath,
      image: signedUrl,
      prompt: userPrompt,
      context,
    });
  } catch (error: any) {
    console.error("AI ROUTE ERROR:", error);
    return Response.json(
      { error: "Failed to generate presenter", details: String(error?.message || error) },
      { status: 500 }
    );
  }
}