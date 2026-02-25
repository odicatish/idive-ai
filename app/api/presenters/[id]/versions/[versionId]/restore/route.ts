// app/api/presenters/[id]/versions/[versionId]/restore/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

function cleanParam(v: unknown) {
  try {
    return decodeURIComponent(String(v ?? "")).trim();
  } catch {
    return String(v ?? "").trim();
  }
}

/**
 * Fallback extractor: /api/presenters/:id/versions/:versionId/restore
 */
function extractFromUrl(url: string) {
  const path = new URL(url).pathname;
  const parts = path.split("/").filter(Boolean);

  const pIdx = parts.indexOf("presenters");
  const vIdx = parts.indexOf("versions");

  const presenterId = pIdx >= 0 ? parts[pIdx + 1] : "";
  const versionId = vIdx >= 0 ? parts[vIdx + 1] : "";

  return {
    presenterId: cleanParam(presenterId),
    versionId: cleanParam(versionId),
    path,
    parts,
  };
}

export async function POST(req: Request, ctx: any) {
  try {
    // ctx.params poate fi object sau Promise (în funcție de setup)
    const rawParams = ctx?.params;
    const params =
      rawParams && typeof rawParams?.then === "function"
        ? await rawParams
        : rawParams ?? {};

    // ia din params (normal)
    let presenterId = cleanParam(params?.id ?? params?.presenterId);
    let versionId = cleanParam(params?.versionId ?? params?.versionid);

    // fallback: ia din URL dacă lipsesc
    if (!presenterId || !versionId) {
      const fromUrl = extractFromUrl(req.url);
      presenterId = presenterId || fromUrl.presenterId;
      versionId = versionId || fromUrl.versionId;
    }

    if (!presenterId || !isUuid(presenterId)) {
      return NextResponse.json(
        {
          error: "invalid_presenter_id",
          _debug: {
            presenterId,
            paramsKeys: Object.keys(params ?? {}),
            url: req.url,
          },
        },
        { status: 400 }
      );
    }

    if (!versionId || !isUuid(versionId)) {
      return NextResponse.json(
        {
          error: "invalid_version_id",
          _debug: {
            versionId,
            paramsKeys: Object.keys(params ?? {}),
            url: req.url,
          },
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

    // current script
    const { data: script, error: sErr } = await supabase
      .from("presenter_scripts")
      .select("id,presenter_id,content,version,language")
      .eq("presenter_id", presenterId)
      .maybeSingle();

    if (sErr) throw sErr;
    if (!script) {
      return NextResponse.json({ error: "script_missing" }, { status: 404 });
    }

    // version to restore (must belong to this script)
    const { data: vRow, error: vErr } = await supabase
      .from("presenter_script_versions")
      .select("id,script_id,version,content,source,meta")
      .eq("id", versionId)
      .eq("script_id", script.id)
      .maybeSingle();

    if (vErr) throw vErr;
    if (!vRow) {
      return NextResponse.json({ error: "version_not_found" }, { status: 404 });
    }

    const targetContent = typeof vRow.content === "string" ? vRow.content : "";
    const nextVersion = (script.version ?? 0) + 1;

    // 1) safety snapshot BEFORE overwrite (source trebuie să rămână "snapshot")
    const { error: snapErr } = await supabase
      .from("presenter_script_versions")
      .insert({
        script_id: script.id,
        version: nextVersion,
        source: "snapshot",
        meta: {
          reason: "pre_restore_snapshot",
          from_version_id: vRow.id,
          from_version: vRow.version,
          previous_script_version: script.version ?? null,
        },
        content: script.content ?? "",
        created_by: auth.user.id,
      });

    if (snapErr) throw snapErr;

    // 2) overwrite current script with selected version content + bump version
    const { error: upErr } = await supabase
      .from("presenter_scripts")
      .update({
        content: targetContent,
        version: nextVersion,
        updated_at: new Date().toISOString(),
        updated_by: auth.user.id,
      } as any)
      .eq("id", script.id);

    if (upErr) throw upErr;

    // 3) record restore action as another "snapshot" (action stored in meta.reason)
    const { error: insErr } = await supabase
      .from("presenter_script_versions")
      .insert({
        script_id: script.id,
        version: nextVersion,
        source: "snapshot",
        meta: {
          reason: "restore",
          from_version_id: vRow.id,
          from_version: vRow.version,
        },
        content: targetContent,
        created_by: auth.user.id,
      });

    if (insErr) throw insErr;

    return NextResponse.json({
      script: {
        id: script.id,
        presenterId,
        content: targetContent,
        language: script.language ?? "ro",
        version: nextVersion,
        updatedAt: new Date().toISOString(),
        updatedBy: auth.user.id,
      },
    });
  } catch (e: any) {
    console.error("RESTORE_ERROR", e);
    return NextResponse.json(
      { error: "internal_error", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}