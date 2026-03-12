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

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) {
    redirect(`/login?next=${encodeURIComponent(`/studio/${presenterId}`)}`);
  }

  const { data: presenter, error: presenterErr } = await supabase
    .from("presenters")
    .select("id,user_id,name,context,use_case")
    .eq("id", presenterId)
    .maybeSingle();

  if (presenterErr) {
    console.error("STUDIO_PRESENTER_LOAD_ERROR", presenterErr);
    notFound();
  }

  if (!presenter || presenter.user_id !== auth.user.id) notFound();

  const { data: existingScript, error: scriptErr } = await supabase
    .from("presenter_scripts")
    .select("id,presenter_id,content,language,version,updated_at,updated_by")
    .eq("presenter_id", presenterId)
    .maybeSingle();

  if (scriptErr) {
    console.error("STUDIO_SCRIPT_LOAD_ERROR", scriptErr);
    notFound();
  }

  let script = existingScript;

  if (!script) {
    const { data: insertedScript, error: insertErr } = await supabase
      .from("presenter_scripts")
      .insert({
        presenter_id: presenterId,
        content: "",
        language: "ro",
        created_by: auth.user.id,
        updated_by: auth.user.id,
      })
      .select("id,presenter_id,content,language,version,updated_at,updated_by")
      .single();

    if (insertErr || !insertedScript) {
      console.error("STUDIO_SCRIPT_INSERT_ERROR", insertErr);
      notFound();
    }

    script = insertedScript;

    const { error: historyErr } = await supabase
      .from("presenter_script_versions")
      .upsert(
        {
          script_id: script.id,
          content: script.content ?? "",
          version: script.version ?? 1,
          source: "snapshot",
          meta: { reason: "bootstrap" },
          created_by: auth.user.id,
        },
        { onConflict: "script_id,version", ignoreDuplicates: true }
      );

    if (historyErr) {
      console.warn("STUDIO_SCRIPT_HISTORY_UPSERT_WARN", historyErr);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <ScriptEditor
        initialPresenter={{
          id: presenter.id,
          name: (presenter as any).name ?? "Untitled Presenter",
          context: (presenter as any).context ?? {},
          useCase: (presenter as any).use_case ?? null,
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