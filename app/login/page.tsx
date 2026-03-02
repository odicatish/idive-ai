// app/login/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { redirect } from "next/navigation";
import LoginClient from "./LoginClient";
import { supabaseServer } from "@/lib/supabase/server";

type LastRow = { presenter_id: string; created_at: string };

function pickLatest(a: LastRow | null, b: LastRow | null): LastRow | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a.created_at).getTime() >= new Date(b.created_at).getTime()
    ? a
    : b;
}

export default async function Page() {
  const supabase = await supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not logged in -> show login UI
  if (!user) return <LoginClient />;

  // 1) get user's presenters
  const { data: presenters, error: pErr } = await supabase
    .from("presenters")
    .select("id")
    .eq("user_id", user.id);

  if (pErr) {
    // dacă RLS blochează, mai bine trimitem în studio/create decât să crăpăm
    redirect("/create");
  }

  const presenterIds = (presenters ?? []).map((p) => p.id).filter(Boolean);

  if (presenterIds.length === 0) {
    redirect("/create");
  }

  // 2) latest script across user's presenters
  const { data: lastScript } = await supabase
    .from("presenter_scripts")
    .select("presenter_id, created_at")
    .in("presenter_id", presenterIds)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<LastRow>();

  // 3) latest job across user's presenters
  const { data: lastJob } = await supabase
    .from("presenter_video_jobs")
    .select("presenter_id, created_at")
    .in("presenter_id", presenterIds)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<LastRow>();

  // 4) pick newest of the two
  const best = pickLatest(lastScript ?? null, lastJob ?? null);

  // fallback: first presenter in list
  const targetPresenterId = best?.presenter_id || presenterIds[0];

  redirect(`/studio/${targetPresenterId}`);
}