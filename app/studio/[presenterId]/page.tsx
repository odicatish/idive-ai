import { notFound, redirect } from "next/navigation";
import ScriptEditor from "./ScriptEditor";
import { supabaseServer } from "@/lib/supabase/server";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

type Params = { presenterId: string } | Promise<{ presenterId: string }>;

export default async function StudioPage({ params }: { params: Params }) {
  const resolvedParams = await Promise.resolve(params).catch(() => null);
  const presenterId = resolvedParams?.presenterId;

  if (!presenterId || !isUuid(presenterId)) notFound();

  const supabase = await supabaseServer();

  // auth
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) redirect("/login");

  // owner check + load presenter context
  const { data: presenter, error: pErr } = await supabase
    .from("presenters")
    .select("id,user_id,name,context")
    .eq("id", presenterId)
    .maybeSingle();

  if (pErr) {
    console.error("PRESENTER_LOAD_ERROR", pErr);
    notFound();
  }
  if (!presenter || presenter.user_id !== auth.user.id) notFound();

  // load script
  const { data: existingScript, error: sErr } = await supabase
    .from("presenter_scripts")
    .select("*")
    .eq("presenter_id", presenterId)
    .maybeSingle();

  if (sErr) {
    console.error("SCRIPT_LOAD_ERROR", sErr);
    notFound();
  }

  let script = existingScript;

  // auto-create script if missing
  if (!script) {
    const { data: inserted, error: insErr } = await supabase
      .from("presenter_scripts")
      .insert({
        presenter_id: presenterId,
        content: "",
        language: "ro",
        created_by: auth.user.id,
        updated_by: auth.user.id,
      })
      .select("*")
      .single();

    if (insErr) {
      console.error("SCRIPT_INSERT_ERROR", insErr);
      notFound();
    }

    script = inserted;

    // best-effort history
    const { error: histErr } = await supabase
      .from("presenter_script_versions")
      .insert({
        script_id: script.id,
        content: script.content,
        version: script.version,
        source: "snapshot",
        meta: { reason: "bootstrap" },
        created_by: auth.user.id,
      });

    if (histErr) console.warn("SCRIPT_HISTORY_INSERT_WARN", histErr);
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <ScriptEditor
        initialPresenter={{
          id: presenter.id,
          name: (presenter as any).name ?? "Untitled Presenter",
          context: (presenter as any).context ?? {},
        }}
        initialScript={{
          id: script.id,
          presenterId: script.presenter_id,
          content: script.content ?? "",
          language: script.language ?? "ro",
          version: script.version ?? 1,
          updatedAt: script.updated_at ?? null,
          updatedBy: script.updated_by ?? null,
        }}
      />
    </div>
  );
}