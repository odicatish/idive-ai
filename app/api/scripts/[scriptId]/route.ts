import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { scriptId: string } }
) {
  const supabase = await supabaseServer();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const scriptId = params.scriptId;
  const body = await req.json().catch(() => null);

  if (!body || typeof body.content !== "string" || typeof body.version !== "number") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const force = body.force === true;
  const content = body.content;
  const clientVersion = body.version;

  // Read current (RLS ensures ownership)
  const { data: current, error: curErr } = await supabase
    .from("presenter_scripts")
    .select("id,content,version,language")
    .eq("id", scriptId)
    .single();

  if (curErr || !current) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (!force && current.version !== clientVersion) {
    return NextResponse.json(
      {
        error: "conflict",
        serverVersion: current.version,
        serverContent: current.content,
      },
      { status: 409 }
    );
  }

  const nextVersion = current.version + 1;

  const { data: updated, error: updErr } = await supabase
    .from("presenter_scripts")
    .update({
      content,
      version: nextVersion,
      updated_by: auth.user.id,
    })
    .eq("id", scriptId)
    .select("id,content,version,language,updated_at,updated_by")
    .single();

  if (updErr || !updated) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  // Write version row (best-effort)
  await supabase.from("presenter_script_versions").insert({
    script_id: scriptId,
    content,
    version: updated.version,
    source: force ? "force_overwrite" : "manual",
    meta: {},
    created_by: auth.user.id,
  });

  return NextResponse.json({
    script: {
      id: updated.id,
      content: updated.content,
      version: updated.version,
      language: updated.language,
      updatedAt: updated.updated_at,
      updatedBy: updated.updated_by,
    },
  });
}
