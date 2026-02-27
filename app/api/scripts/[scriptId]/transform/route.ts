// app/api/scripts/[scriptId]/transform/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { openaiServer } from "@/lib/openai/client";
import type OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSupabase() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set() {},
      remove() {},
    },
  });
}

function jsonError(status: number, error: string, details?: any) {
  return NextResponse.json({ error, ...(details ? { details } : {}) }, { status });
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export async function POST(req: Request, ctx: { params: { scriptId: string } }) {
  try {
    const supabase = await getSupabase();

    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth?.user) return jsonError(401, "NOT_AUTHENTICATED");

    const scriptId = String(ctx?.params?.scriptId ?? "").trim();
    if (!scriptId || !isUuid(scriptId)) return jsonError(400, "invalid_script_id");

    const body = await req.json().catch(() => ({}));
    const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
    if (!instruction) return jsonError(400, "invalid_body", "instruction required");

    // load current script
    const { data: script, error: sErr } = await supabase
      .from("presenter_scripts")
      .select("id, presenter_id, content, version, language")
      .eq("id", scriptId)
      .maybeSingle();

    if (sErr) return jsonError(500, "script_load_failed", sErr.message);
    if (!script) return jsonError(404, "NOT_FOUND");

    const prevVersion = Number.isFinite(script.version) ? Number(script.version) : 1;
    const nextVersion = prevVersion + 1;
    const now = new Date().toISOString();

    const baseText = String(script.content ?? "");

    // ✅ Snapshot saved state before transform (best-effort) — NO DUPLICATE CRASH
    const { error: preErr } = await supabase
      .from("presenter_script_versions")
      .upsert(
        {
          script_id: scriptId,
          version: prevVersion,
          source: "snapshot",
          meta: { reason: "transform", phase: "pre" },
          content: baseText,
          created_by: auth.user.id,
        },
        { onConflict: "script_id,version", ignoreDuplicates: true }
      );

    if (preErr) console.warn("SCRIPT_HISTORY_UPSERT_WARN(pre)", preErr);

    // run AI transform
    const openai = openaiServer as unknown as OpenAI;

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        finalText: { type: "string", minLength: 1 },
      },
      required: ["finalText"],
    } as const;

    let jsonText = "";
    try {
      const resp = await openai.responses.create({
        model: process.env.OPENAI_PREMIUM_MODEL || "gpt-4o-mini",
        input: [
          { role: "system", content: "Rewrite the script per the instruction. Return ONLY JSON that matches the schema." },
          { role: "user", content: `${instruction}\n\nSCRIPT:\n${baseText}` },
        ],
        text: {
          format: { type: "json_schema", name: "transform_v1", strict: true, schema },
        },
      });
      jsonText = resp.output_text?.trim() ?? "";
    } catch (e: any) {
      console.error("OPENAI_TRANSFORM_ERROR", e);
      return jsonError(502, "openai_failed", e?.message ?? String(e));
    }

    if (!jsonText) return jsonError(500, "ai_empty_output");

    let parsed: any = null;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e: any) {
      return jsonError(500, "ai_invalid_json", { message: e?.message, raw: jsonText });
    }

    const finalText = String(parsed?.finalText ?? "").trim();
    if (!finalText) return jsonError(500, "ai_missing_finalText");

    // update script
    const { data: updated, error: updErr } = await supabase
      .from("presenter_scripts")
      .update({
        content: finalText,
        version: nextVersion,
        updated_at: now,
        updated_by: auth.user.id,
      })
      .eq("id", scriptId)
      .select("id, presenter_id, content, version, language, updated_at, updated_by")
      .single();

    if (updErr) return jsonError(500, "script_update_failed", updErr.message);

    // ✅ Snapshot after transform (best-effort) — NO DUPLICATE CRASH
    const { error: postErr } = await supabase
      .from("presenter_script_versions")
      .upsert(
        {
          script_id: scriptId,
          version: updated.version ?? nextVersion,
          source: "snapshot",
          meta: { reason: "transform", phase: "post", instruction },
          content: updated.content ?? finalText,
          created_by: auth.user.id,
        },
        { onConflict: "script_id,version", ignoreDuplicates: true }
      );

    if (postErr) console.warn("SCRIPT_HISTORY_UPSERT_WARN(post)", postErr);

    return NextResponse.json({
      ok: true,
      event: "done",
      script: {
        id: updated.id,
        presenterId: updated.presenter_id,
        content: updated.content ?? "",
        version: updated.version ?? nextVersion,
        language: updated.language ?? "ro",
        updatedAt: updated.updated_at ?? now,
        updatedBy: updated.updated_by ?? auth.user.id,
      },
    });
  } catch (e: any) {
    console.error("POST /api/scripts/[scriptId]/transform error:", e);
    return jsonError(500, "internal_error", e?.message ?? String(e));
  }
}