import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { openai } from "@/lib/openai/client";
import {
  buildTransformInstruction,
  systemPrompt,
  TransformType,
} from "@/lib/scripts/prompts";

export const runtime = "nodejs";

type Body = {
  type: TransformType;
  params?: { targetLanguage?: string };
  draft?: string;
};

function sseChunk(data: any) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { scriptId: string } }
) {
  const supabase = await supabaseServer();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
    });
  }

  const scriptId = params.scriptId;
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || !body.type) {
    return new Response(JSON.stringify({ error: "bad_request" }), {
      status: 400,
    });
  }

  const { data: script, error: sErr } = await supabase
    .from("presenter_scripts")
    .select("id,content,version,language,presenter_id")
    .eq("id", scriptId)
    .single();

  if (sErr || !script) {
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
  }

  // Snapshot saved state before transform (best-effort)
  await supabase.from("presenter_script_versions").insert({
    script_id: scriptId,
    content: script.content,
    version: script.version,
    source: "snapshot",
    meta: { before: body.type },
    created_by: auth.user.id,
  });

  const baseText = typeof body.draft === "string" ? body.draft : script.content;

  const instruction = buildTransformInstruction({
    type: body.type,
    fromLanguage: script.language,
    toLanguage: body.params?.targetLanguage,
  });

  const stream = new ReadableStream({
    start: async (controller) => {
      const encoder = new TextEncoder();
      let acc = "";

      try {
        controller.enqueue(encoder.encode(sseChunk({ event: "start" })));

        const response = await openai.responses.create({
          model: "gpt-4.1-mini",
          input: [
            { role: "system", content: systemPrompt() },
            { role: "user", content: `${instruction}\n\nSCRIPT:\n${baseText}` },
          ],
          stream: true,
        });

        for await (const event of response as any) {
          const delta =
            event?.type === "response.output_text.delta"
              ? event.delta
              : typeof event?.delta === "string"
                ? event.delta
                : null;

          if (typeof delta === "string" && delta.length) {
            acc += delta;
            controller.enqueue(encoder.encode(sseChunk({ event: "delta", delta })));
          }
        }

        const finalText = acc.trim();
        const nextVersion = script.version + 1;

        const nextLanguage =
          body.type === "translate" && body.params?.targetLanguage
            ? body.params.targetLanguage
            : script.language;

        const { data: updated, error: updErr } = await supabase
          .from("presenter_scripts")
          .update({
            content: finalText,
            version: nextVersion,
            updated_by: auth.user.id,
            language: nextLanguage,
          })
          .eq("id", scriptId)
          .select("id,content,version,language,updated_at,updated_by")
          .single();

        if (!updErr && updated) {
          await supabase.from("presenter_script_versions").insert({
            script_id: scriptId,
            content: updated.content,
            version: updated.version,
            source: body.type,
            meta: {
              fromLanguage: script.language,
              toLanguage: body.params?.targetLanguage ?? null,
              model: "gpt-4.1-mini",
            },
            created_by: auth.user.id,
          });

          controller.enqueue(
            encoder.encode(
              sseChunk({
                event: "done",
                script: {
                  id: updated.id,
                  content: updated.content,
                  version: updated.version,
                  language: updated.language,
                  updatedAt: updated.updated_at,
                  updatedBy: updated.updated_by,
                },
              })
            )
          );
        } else {
          controller.enqueue(
            encoder.encode(sseChunk({ event: "error", error: "save_failed" }))
          );
        }

        controller.close();
      } catch {
        controller.enqueue(
          encoder.encode(sseChunk({ event: "error", error: "openai_failed" }))
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
