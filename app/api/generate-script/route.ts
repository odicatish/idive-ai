// app/api/generate-script/route.ts
import OpenAI from "openai";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
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
  const signed = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60);

  if (signed.error) throw new Error(`Signed URL failed: ${signed.error.message}`);
  if (!signed.data?.signedUrl) throw new Error("Signed URL missing signedUrl");

  return signed.data.signedUrl;
}

/**
 * SSR session -> user id (fără să schimbi arhitectura)
 * Folosim @supabase/ssr direct aici ca să setăm presenters.user_id corect.
 */
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
            // în route handler, cookies() e read-only uneori; SSR client poate cere setAll
            // Ignorăm setarea aici — pentru getUser e suficient să citim.
            try {
              cookiesToSet.forEach(({ name, value, options }) => {
                cookieStore.set(name, value, options);
              });
            } catch {
              // ignore
            }
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

    //////////////////////////////////////////////////////
    // ✅ session user_id (pentru ownership + audit)
    //////////////////////////////////////////////////////
    const userId = await getUserIdFromSession();
    if (!userId) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    //////////////////////////////////////////////////////
    // ✅ USER PROMPT (optional)
    //////////////////////////////////////////////////////
    const userPrompt =
      typeof body.prompt === "string" && body.prompt.trim().length > 0
        ? body.prompt.trim()
        : null;

    //////////////////////////////////////////////////////
    // ✅ CONTEXT (Scene / Domain / Audience / Tone / Visual)
    //////////////////////////////////////////////////////
    const ctxIn = body?.context && typeof body.context === "object" ? body.context : {};

    const context = {
      location: normalizeStr(ctxIn.location, 160),
      domain: normalizeStr(ctxIn.domain, 120) || normalizeStr(body.industry, 120), // fallback din industry
      audience: normalizeStr(ctxIn.audience, 140),
      tone: normalizeStr(ctxIn.tone, 40) || "premium",
      visual: normalizeStr(ctxIn.visual, 60) || "apple-cinematic",
      notes: normalizeStr(ctxIn.notes, 400),
    };

    // mic “director’s card” care ridică calitatea
    const contextBlock = `
SCENE / CONTEXT (VERY IMPORTANT):
- Location: ${context.location || "not specified"}
- Domain/Industry: ${context.domain || "not specified"}
- Audience: ${context.audience || "not specified"}
- Tone: ${context.tone}
- Visual vibe: ${context.visual}
- Notes: ${context.notes || "none"}

DIRECTION:
Write like a premium Apple-style narrator: minimal, confident, precise.
Add subtle cinematic micro-moments (1–2 vivid lines max), never cheesy.
Keep the language natural and spoken, not robotic.
`.trim();

    //////////////////////////////////////////////////////
    // ✅ WARDROBE MODE (păstrat)
    //////////////////////////////////////////////////////
    if (body.presenter && body.wardrobe) {
      const locked = body.presenter as any;

      const imagePrompt = `
Ultra realistic cinematic portrait.

PERSON (KEEP SAME FACE):
${locked.appearance ?? ""}

WARDROBE:
${String(body.wardrobe ?? "")}

IMPORTANT:
- KEEP same identity
- same facial structure
- same age
- same ethnicity
- change ONLY clothing

Shot on 85mm lens
studio lighting
extreme skin detail
natural imperfections
`.trim();

      const img = await openai.images.generate({
        model: "gpt-image-1",
        prompt: imagePrompt,
        size: "1024x1536",
      });

      const b64 = img.data?.[0]?.b64_json;
      if (!b64) {
        return Response.json(
          { error: "Image generation failed (no base64 returned)" },
          { status: 500 }
        );
      }

      const bytes = Buffer.from(b64, "base64");
      const filePath = `${locked.id || "no-id"}/${randomId()}.png`;

      const up = await supabaseAdmin.storage.from(BUCKET).upload(filePath, bytes, {
        contentType: "image/png",
        upsert: false,
      });

      if (up.error) {
        return Response.json(
          { error: "Storage upload failed", details: up.error.message },
          { status: 500 }
        );
      }

      if (locked.id) {
        await supabaseAdmin
          .from("presenters")
          .update({ image_path: filePath })
          .eq("id", locked.id);
      }

      const signedUrl = await getSignedUrl(filePath);

      return Response.json({
        ...locked,
        image_path: filePath,
        image: signedUrl,
      });
    }

    //////////////////////////////////////////////////////
    // ✅ NEW HUMAN MODE
    //////////////////////////////////////////////////////
    const genderIn = body.gender || "any";
    const age = body.age || "30-45";
    const industry = body.industry || "business";
    const energy = body.energy || "executive";
    const style = body.style || "authoritative";

    const genderRule =
      genderIn === "any"
        ? `Choose ONE gender: "male" or "female" and set it in the JSON field "gender".`
        : `Gender MUST be "${genderIn}". Set JSON field "gender" accordingly.`;

    const creativeDirection = userPrompt
      ? `
USER CREATIVE BRIEF (EXTREMELY IMPORTANT):
${userPrompt}

Follow the user's brief carefully when writing the SCRIPT.
Do NOT ignore it.
`
      : `
No specific creative brief provided.
Create a strong marketing-style script suitable for the selected domain.
`;

    const systemStyleHint =
      context.visual === "ultra-minimal"
        ? "Ultra minimal delivery. Fewer adjectives. Crisp sentences."
        : context.visual === "dark-studio"
        ? "Dark studio vibe. Controlled intensity. Still premium and clean."
        : "Apple-clean with subtle cinematic micro-moments. Premium SaaS feel.";

    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      input: `
Create a hyper-realistic AI presenter in VALID JSON following the schema.

Constraints:
- ${genderRule}
- Age range: ${age}
- Domain/Industry: ${context.domain || industry}
- Energy: ${energy}
- Style: ${style}

${contextBlock}

STYLE HINT:
${systemStyleHint}

CRITICAL CONSISTENCY RULE:
- The presenter NAME must match the gender (male name for male, female name for female).
- Use a realistic first + last name.

${creativeDirection}

SCRIPT RULES:
- language: Romanian (ro) unless user brief clearly requests otherwise
- natural spoken language
- not robotic
- strong hook in first sentence
- clean structure (2–4 short beats)
- persuasive, premium
- Target duration: 20–30 seconds spoken
- include a call-to-action when appropriate
- avoid hype words like "revoluționar", "garantat", "cel mai bun din lume"

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
      return Response.json(
        { error: "Text generation failed (empty output_text)" },
        { status: 500 }
      );
    }

    let presenter: PresenterJson;
    try {
      presenter = JSON.parse(jsonText);
    } catch (e: any) {
      return Response.json(
        { error: "Failed to parse model JSON", details: e?.message, raw: jsonText },
        { status: 500 }
      );
    }

    //////////////////////////////////////////////////////
    // ✅ IMAGE (force gender in prompt too)
    //////////////////////////////////////////////////////
    const imagePrompt = `
Ultra realistic cinematic portrait.

GENDER: ${presenter.gender}
AGE RANGE: ${age}

APPEARANCE / IDENTITY:
${presenter.appearance}

CONTEXT:
Location: ${context.location || "not specified"}
Domain: ${context.domain || industry}
Tone: ${context.tone}
Visual vibe: ${context.visual}

IMPORTANT:
- completely unique human
- not resembling anyone real
- no celebrity likeness

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
      return Response.json(
        { error: "Image generation failed (no base64 returned)" },
        { status: 500 }
      );
    }

    //////////////////////////////////////////////////////
    // ✅ INSERT presenter (include user_id + context)
    //////////////////////////////////////////////////////
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
        context, // ✅ new
      })
      .select("id")
      .single();

    if (ins.error) {
      return Response.json(
        { error: "DB insert failed", details: ins.error.message },
        { status: 500 }
      );
    }

    const presenterId = ins.data.id as string;

    //////////////////////////////////////////////////////
    // ✅ upload image
    //////////////////////////////////////////////////////
    const bytes = Buffer.from(b64, "base64");
    const filePath = `${presenterId}/${randomId()}.png`;

    const up = await supabaseAdmin.storage.from(BUCKET).upload(filePath, bytes, {
      contentType: "image/png",
      upsert: false,
    });

    if (up.error) {
      return Response.json(
        { error: "Storage upload failed", details: up.error.message },
        { status: 500 }
      );
    }

    //////////////////////////////////////////////////////
    // ✅ update image_path
    //////////////////////////////////////////////////////
    await supabaseAdmin
      .from("presenters")
      .update({ image_path: filePath })
      .eq("id", presenterId);

    //////////////////////////////////////////////////////
    // ✅ ALSO seed presenter_scripts + versions (so Studio loads instantly)
    //////////////////////////////////////////////////////
    const scriptIns = await supabaseAdmin
      .from("presenter_scripts")
      .insert({
        presenter_id: presenterId,
        content: presenter.script ?? "",
        language: "ro",
        version: 1,
        created_by: userId,
        updated_by: userId,
      })
      .select("id,version,content")
      .single();

    if (!scriptIns.error && scriptIns.data?.id) {
      // best-effort history
      await supabaseAdmin.from("presenter_script_versions").insert({
        script_id: scriptIns.data.id,
        content: scriptIns.data.content,
        version: scriptIns.data.version,
        source: "snapshot",
        meta: { reason: "generate-script" },
        created_by: userId,
      });
    }

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
      {
        error: "Failed to generate presenter",
        details: String(error?.message || error),
      },
      { status: 500 }
    );
  }
}