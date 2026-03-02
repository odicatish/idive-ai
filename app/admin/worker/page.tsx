// app/admin/worker/page.tsx
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import RunWorkerButton from "./RunWorkerButton";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminWorkerPage() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  if (!data?.user) redirect("/login");

  const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const userEmail = (data.user.email || "").trim().toLowerCase();

  if (!adminEmail || userEmail !== adminEmail) {
    // nu expunem faptul că există pagina
    redirect("/login?error=" + encodeURIComponent("Unauthorized"));
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-white flex items-center justify-center px-6">
      <div className="w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
        <h1 className="text-2xl font-bold mb-2">Admin — Worker</h1>
        <p className="text-neutral-400 text-sm mb-5">
          Apasă butonul ca să rulezi worker-ul o singură dată (procesează 1 job queued).
        </p>

        <RunWorkerButton />
      </div>
    </main>
  );
}