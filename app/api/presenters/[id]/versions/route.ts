import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
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
    return { supabase, user: null, error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const { data: presenter, error: pErr } = await supabase
    .from("presenters")
    .select("id,user_id")
    .eq("id", presenterId)
    .maybeSingle();

  if (pErr || !presenter || presenter.user_id !== auth.user.id) {
    return { supabase, user: auth.user, error: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  }

  return { supabase, user: auth.user, error: null };
}

export async function GET(req: Request, ctx: { params: Params }) {
  try {
    const presenterId = await getPresenterId(ctx.params);

    if (!presenterId || !isUuid(presenterId)) {
      return NextResponse.json({ error: "invalid_presenter_id", presenterId }, { status: 400 });
    }

    const { supabase, error } = await requireOwner(presenterId);
    if (error) return error;

    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 30), 1), 200);

    const { data: script, error: sErr } = await supabase
      .from("presenter_scripts")
      .select("id")
      .eq("presenter_id", presenterId)
      .maybeSingle();

    if (sErr) throw sErr;
    if (!script?.id) return NextResponse.json({ versions: [] });

    const { data: versions, error: vErr } = await supabase
      .from("presenter_script_versions")
      .select("id,script_id,version,source,meta,created_at,created_by")
      .eq("script_id", script.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (vErr) throw vErr;

    return NextResponse.json({ versions: versions ?? [] });
  } catch (e: any) {
    console.error("VERSIONS_GET_ERROR", e);
    return NextResponse.json({ error: "internal_error", details: e?.message ?? String(e) }, { status: 500 });
  }
}

export async function POST(_req: Request, ctx: { params: Params }) {
  try {
    const presenterId = await getPresenterId(ctx.params);

    if (!presenterId || !isUuid(presenterId)) {
      return NextResponse.json({ error: "invalid_presenter_id", presenterId }, { status: 400 });
    }

    const { supabase, user, error } = await requireOwner(presenterId);
    if (error) return error;

    const { data: script, error: sErr } = await supabase
      .from("presenter_scripts")
      .select("id,content,version")
      .eq("presenter_id", presenterId)
      .single();

    if (sErr) throw sErr;

    const { data: inserted, error: insErr } = await supabase
      .from("presenter_script_versions")
      .insert({
        script_id: script.id,
        content: script.content ?? "",
        version: script.version ?? 1,
        source: "snapshot",
        meta: { reason: "manual" },
        created_by: user!.id,
      })
      .select("id,script_id,version,source,meta,created_at,created_by")
      .single();

    if (insErr) throw insErr;

    return NextResponse.json({ version: inserted });
  } catch (e: any) {
    console.error("VERSIONS_POST_ERROR", e);
    return NextResponse.json({ error: "internal_error", details: e?.message ?? String(e) }, { status: 500 });
  }
}