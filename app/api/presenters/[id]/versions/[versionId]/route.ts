// app/api/presenters/[id]/versions/[versionId]/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

function cleanParam(v: unknown) {
  return decodeURIComponent(String(v ?? "")).trim();
}

/**
 * Extract presenterId/versionId robust:
 * - Prefer params
 * - Fallback parse from URL path: /api/presenters/:id/versions/:versionId
 */
function extractIds(req: Request, params?: Record<string, string | undefined>) {
  const p = params ?? {};

  // 1) try params (robust to naming)
  let presenterId = cleanParam(p.id ?? (p as any).presenterId);
  let versionId = cleanParam((p as any).versionId ?? (p as any).versionid);

  // 2) fallback parse from pathname
  if (!presenterId || !versionId) {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    // expected: ["api","presenters",":id","versions",":versionId"]
    const presentersIdx = parts.indexOf("presenters");
    const versionsIdx = parts.indexOf("versions");

    const pid = presentersIdx >= 0 ? parts[presentersIdx + 1] : "";
    const vid = versionsIdx >= 0 ? parts[versionsIdx + 1] : "";

    if (!presenterId) presenterId = cleanParam(pid);
    if (!versionId) versionId = cleanParam(vid);
  }

  return { presenterId, versionId, _keys: Object.keys(p) };
}

export async function GET(
  req: Request,
  { params }: { params: Record<string, string | undefined> }
) {
  try {
    const { presenterId, versionId, _keys } = extractIds(req, params);

    if (!presenterId || !isUuid(presenterId)) {
      return NextResponse.json(
        {
          error: "invalid_presenter_id",
          _debug: { received: presenterId, keys: _keys, url: req.url },
        },
        { status: 400 }
      );
    }

    if (!versionId || !isUuid(versionId)) {
      return NextResponse.json(
        {
          error: "invalid_version_id",
          _debug: { received: versionId, keys: _keys, url: req.url },
        },
        { status: 400 }
      );
    }

    const supabase = await supabaseServer();

    // auth
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // owner check presenter
    const { data: presenter, error: pErr } = await supabase
      .from("presenters")
      .select("id,user_id")
      .eq("id", presenterId)
      .maybeSingle();

    if (pErr || !presenter || presenter.user_id !== auth.user.id) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    // get script_id for this presenter
    const { data: script, error: sErr } = await supabase
      .from("presenter_scripts")
      .select("id,presenter_id")
      .eq("presenter_id", presenterId)
      .maybeSingle();

    if (sErr) throw sErr;
    if (!script) {
      return NextResponse.json({ error: "script_missing" }, { status: 404 });
    }

    // load version by id + script_id
    const { data: version, error: vErr } = await supabase
      .from("presenter_script_versions")
      .select("id,script_id,version,source,meta,content,created_at,created_by")
      .eq("id", versionId)
      .eq("script_id", script.id)
      .maybeSingle();

    if (vErr) throw vErr;
    if (!version) {
      return NextResponse.json({ error: "version_not_found" }, { status: 404 });
    }

    return NextResponse.json({ version });
  } catch (e: any) {
    console.error("VERSION_GET_ERROR", e);
    return NextResponse.json(
      { error: "internal_error", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}