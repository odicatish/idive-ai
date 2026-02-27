import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

type Params = { id: string } | Promise<{ id: string }>;

async function getPresenterId(params: Params) {
  const resolved = await Promise.resolve(params).catch(() => null);
  return resolved?.id ?? null;
}

async function requireOwner(presenterId: string) {
  const supabase = await supabaseServer();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) {
    return {
      supabase,
      user: null,
      error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  const { data: presenter, error: pErr } = await supabase
    .from("presenters")
    .select("id,user_id")
    .eq("id", presenterId)
    .maybeSingle();

  if (pErr || !presenter || presenter.user_id !== auth.user.id) {
    return {
      supabase,
      user: auth.user,
      error: NextResponse.json({ error: "not_found" }, { status: 404 }),
    };
  }

  return { supabase, user: auth.user, error: null };
}

export async function GET(_req: Request, ctx: { params: Params }) {
  try {
    const presenterId = await getPresenterId(ctx.params);

    if (!presenterId || !isUuid(presenterId)) {
      return NextResponse.json(
        { error: "invalid_presenter_id", presenterId },
        { status: 400 }
      );
    }

    const { supabase, user, error } = await requireOwner(presenterId);
    if (error) return error;

    let { data: script, error: sErr } = await supabase
      .from("presenter_scripts")
      .select("*")
      .eq("presenter_id", presenterId)
      .maybeSingle();

    if (sErr) throw sErr;

    if (!script) {
      const { data: inserted, error: insErr } = await supabase
        .from("presenter_scripts")
        .insert({
          presenter_id: presenterId,
          content: "",
          language: "ro",
          created_by: user!.id,
          updated_by: user!.id,
        })
        .select("*")
        .single();

      if (insErr) throw insErr;
      script = inserted;

      // ✅ history (best effort, ignore duplicates via unique (script_id, version))
      const { error: histErr } = await supabase
        .from("presenter_script_versions")
        .upsert(
          {
            script_id: script.id,
            content: script.content ?? "",
            version: script.version ?? 1,
            source: "snapshot",
            meta: { reason: "bootstrap" },
            created_by: user!.id,
          },
          { onConflict: "script_id,version", ignoreDuplicates: true }
        );

      if (histErr) console.warn("SCRIPT_HISTORY_UPSERT_WARN(GET)", histErr);
    }

    return NextResponse.json({ script });
  } catch (e: any) {
    console.error("SCRIPT_GET_ERROR", e);
    return NextResponse.json(
      { error: "internal_error", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request, ctx: { params: Params }) {
  try {
    const presenterId = await getPresenterId(ctx.params);

    if (!presenterId || !isUuid(presenterId)) {
      return NextResponse.json(
        { error: "invalid_presenter_id", presenterId },
        { status: 400 }
      );
    }

    const { supabase, user, error } = await requireOwner(presenterId);
    if (error) return error;

    const body = await req.json().catch(() => ({}));

    const content = typeof body.content === "string" ? body.content : null;
    const force = body.force === true;

    const clientVersionRaw = body.version;
    const clientVersion =
      typeof clientVersionRaw === "number"
        ? clientVersionRaw
        : typeof clientVersionRaw === "string" && clientVersionRaw.trim() !== ""
        ? Number(clientVersionRaw)
        : null;

    if (content === null) {
      return NextResponse.json(
        {
          error: "invalid_body",
          details: "content must be string",
          received: { contentType: typeof body.content },
        },
        { status: 400 }
      );
    }

    if (clientVersion !== null && Number.isNaN(clientVersion)) {
      return NextResponse.json(
        {
          error: "invalid_body",
          details: "version must be a number",
          received: { version: body.version },
        },
        { status: 400 }
      );
    }

    const { data: current, error: curErr } = await supabase
      .from("presenter_scripts")
      .select("*")
      .eq("presenter_id", presenterId)
      .single();

    if (curErr || !current) {
      return NextResponse.json({ error: "script_missing" }, { status: 404 });
    }

    if (!force && clientVersion !== null && (current.version ?? 1) !== clientVersion) {
      return NextResponse.json(
        {
          error: "conflict",
          serverVersion: current.version ?? 1,
          serverContent: current.content ?? "",
        },
        { status: 409 }
      );
    }

    const nextVersion = (current.version ?? 1) + 1;
    const now = new Date().toISOString();

    const { data: updated, error: upErr } = await supabase
      .from("presenter_scripts")
      .update({
        content,
        version: nextVersion,
        updated_at: now,
        updated_by: user!.id,
      })
      .eq("id", current.id)
      .select("*")
      .single();

    if (upErr) throw upErr;

    // ✅ history (best effort, ignore duplicates)
    const { error: histErr } = await supabase
      .from("presenter_script_versions")
      .upsert(
        {
          script_id: updated.id,
          content: updated.content ?? "",
          version: updated.version ?? nextVersion,
          source: "autosave",
          meta: { reason: "save" },
          created_by: user!.id,
        },
        { onConflict: "script_id,version", ignoreDuplicates: true }
      );

    if (histErr) console.warn("SCRIPT_HISTORY_UPSERT_WARN(PATCH)", histErr);

    return NextResponse.json({ script: updated });
  } catch (e: any) {
    console.error("SCRIPT_PATCH_ERROR", e);
    return NextResponse.json(
      { error: "internal_error", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}