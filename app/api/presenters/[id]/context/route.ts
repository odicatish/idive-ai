import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

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
    return { supabase, user: null, presenter: null, error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const { data: presenter, error: pErr } = await supabase
    .from("presenters")
    .select("id,user_id,context")
    .eq("id", presenterId)
    .maybeSingle();

  if (pErr) {
    console.error("CONTEXT_OWNER_PRESENTER_SELECT_ERROR", pErr);
    return { supabase, user: auth.user, presenter: null, error: NextResponse.json({ error: "internal_error", where: "presenter_select" }, { status: 500 }) };
  }

  if (!presenter || presenter.user_id !== auth.user.id) {
    return { supabase, user: auth.user, presenter: null, error: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  }

  return { supabase, user: auth.user, presenter, error: null };
}

export async function PATCH(req: Request, ctx: { params: Params }) {
  const presenterId = await getPresenterId(ctx.params);

  if (!presenterId || !isUuid(presenterId)) {
    return NextResponse.json({ error: "invalid_presenter_id", presenterId }, { status: 400 });
  }

  const { supabase, presenter, error } = await requireOwner(presenterId);
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const incoming = body?.context;

  const isPlainObject =
    incoming && typeof incoming === "object" && !Array.isArray(incoming);

  if (!isPlainObject) {
    return NextResponse.json(
      { error: "invalid_body", details: "context must be an object" },
      { status: 400 }
    );
  }

  // merge safe
  const next = { ...(presenter!.context ?? {}), ...incoming };

  const { data: updated, error: upErr } = await supabase
    .from("presenters")
    .update({ context: next })
    .eq("id", presenterId)
    .select("id,context")
    .single();

  if (upErr) {
    console.error("CONTEXT_UPDATE_ERROR", {
      message: upErr.message,
      code: (upErr as any).code,
      details: (upErr as any).details,
      hint: (upErr as any).hint,
    });
    return NextResponse.json(
      {
        error: "context_update_failed",
        message: upErr.message,
        code: (upErr as any).code ?? null,
        details: (upErr as any).details ?? null,
        hint: (upErr as any).hint ?? null,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ context: updated.context ?? {} });
}