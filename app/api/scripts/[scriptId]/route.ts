// app/api/scripts/[scriptId]/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

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

export async function GET(_req: Request, ctx: { params: { scriptId: string } }) {
  try {
    const supabase = await getSupabase();

    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth?.user) return jsonError(401, "NOT_AUTHENTICATED");

    const scriptId = String(ctx?.params?.scriptId ?? "").trim();
    if (!scriptId || !isUuid(scriptId)) return jsonError(400, "invalid_script_id");

    // read script
    const { data: script, error: curErr } = await supabase
      .from("presenter_scripts")
      .select("id, presenter_id, content, version, language, updated_at")
      .eq("id", scriptId)
      .maybeSingle();

    if (curErr) return jsonError(500, "script_load_failed", curErr.message);
    if (!script) return jsonError(404, "NOT_FOUND");

    return NextResponse.json({
      ok: true,
      script: {
        id: script.id,
        presenterId: script.presenter_id,
        content: script.content ?? "",
        version: script.version ?? 1,
        language: script.language ?? "ro",
        updatedAt: script.updated_at ?? null,
      },
    });
  } catch (e: any) {
    console.error("GET /api/scripts/[scriptId] error:", e);
    return jsonError(500, "internal_error", e?.message ?? String(e));
  }
}

export async function PATCH(req: Request, ctx: { params: { scriptId: string } }) {
  try {
    const supabase = await getSupabase();

    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth?.user) return jsonError(401, "NOT_AUTHENTICATED");

    const scriptId = String(ctx?.params?.scriptId ?? "").trim();
    if (!scriptId || !isUuid(scriptId)) return jsonError(400, "invalid_script_id");

    const body = await req.json().catch(() => ({}));
    const content = typeof body?.content === "string" ? body.content : null;

    if (content === null) return jsonError(400, "invalid_body", "content must be string");

    // load current
    const { data: current, error: curErr } = await supabase
      .from("presenter_scripts")
      .select("id, presenter_id, content, version, language")
      .eq("id", scriptId)
      .maybeSingle();

    if (curErr) return jsonError(500, "script_load_failed", curErr.message);
    if (!current) return jsonError(404, "NOT_FOUND");

    const prevVersion = Number.isFinite(current.version) ? Number(current.version) : 1;
    const nextVersion = prevVersion + 1;
    const now = new Date().toISOString();

    // update script
    const { data: updated, error: updErr } = await supabase
      .from("presenter_scripts")
      .update({
        content,
        version: nextVersion,
        updated_at: now,
        updated_by: auth.user.id,
      })
      .eq("id", scriptId)
      .select("id, presenter_id, content, version, language, updated_at, updated_by")
      .single();

    if (updErr) return jsonError(500, "script_update_failed", updErr.message);

    // ✅ Write version row (best-effort) — NO DUPLICATE CRASH
    const { error: histErr } = await supabase
      .from("presenter_script_versions")
      .upsert(
        {
          script_id: scriptId,
          version: updated.version ?? nextVersion,
          source: "snapshot",
          meta: { reason: "patch" },
          content: updated.content ?? "",
          created_by: auth.user.id,
        },
        { onConflict: "script_id,version", ignoreDuplicates: true }
      );

    if (histErr) console.warn("SCRIPT_HISTORY_UPSERT_WARN", histErr);

    return NextResponse.json({
      ok: true,
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
    console.error("PATCH /api/scripts/[scriptId] error:", e);
    return jsonError(500, "internal_error", e?.message ?? String(e));
  }
}