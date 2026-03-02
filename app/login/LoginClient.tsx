"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

const LAST_PRESENTER_KEY = "idive:lastPresenterId";

function getLastPresenterId(): string | null {
  try {
    return localStorage.getItem(LAST_PRESENTER_KEY);
  } catch {
    return null;
  }
}

function setLastPresenterId(id: string) {
  try {
    localStorage.setItem(LAST_PRESENTER_KEY, id);
  } catch {
    // ignore
  }
}

export default function LoginPage() {
  const sp = useSearchParams();
  const router = useRouter();

  const rawError = sp.get("error");
  const errorMsg = rawError ? decodeURIComponent(rawError) : "";

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  async function redirectAfterLogin() {
    const supabase = supabaseBrowser();

    // 1) ultimul folosit
    const last = getLastPresenterId();
    if (last) {
      router.replace(`/studio/${last}`);
      return;
    }

    // 2) primul presenter
    const { data, error } = await supabase
      .from("presenters")
      .select("id, created_at")
      .order("created_at", { ascending: true })
      .limit(1);

    if (!error) {
      const first = data?.[0]?.id;
      if (first) {
        setLastPresenterId(first);
        router.replace(`/studio/${first}`);
        return;
      }
    }

    // 3) fallback
    router.replace("/create");
  }

  // Dacă userul e deja logat (ex: după callback), redirect automat
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const supabase = supabaseBrowser();
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;

        if (data.session) {
          await redirectAfterLogin();
          return;
        }
      } finally {
        if (!cancelled) setCheckingSession(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendMagic = async () => {
    setLoading(true);
    try {
      const supabase = supabaseBrowser();

      // IMPORTANT: trimitem către callback, dar fără să forțăm /create.
      // După callback, userul ajunge logat, iar componenta asta îl duce la "ultimul folosit".
      const redirectTo = `${window.location.origin}/auth/callback`;

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTo,
          shouldCreateUser: true,
        },
      });

      if (error) throw error;
      setSent(true);
    } catch (e: any) {
      alert(e?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-6">
      <div className="w-full max-w-sm bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
        <h1 className="text-2xl font-bold mb-2">Login</h1>
        <p className="text-neutral-400 text-sm mb-5">
          Primești un link pe email (magic link).
        </p>

        {!!errorMsg && (
          <div className="mb-4 text-sm text-red-300 bg-red-900/20 border border-red-800 rounded-xl p-3">
            {errorMsg}
          </div>
        )}

        {checkingSession ? (
          <div className="text-sm text-neutral-300 bg-neutral-800/40 border border-neutral-700 rounded-xl p-3">
            Checking session...
          </div>
        ) : sent ? (
          <div className="text-sm text-green-300 bg-green-900/20 border border-green-800 rounded-xl p-3">
            ✅ Link trimis. Verifică emailul și apasă link-ul.
          </div>
        ) : (
          <>
            <input
              className="w-full px-4 py-3 rounded-xl bg-black/30 border border-neutral-700 outline-none focus:border-neutral-400"
              placeholder="email@domain.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <button
              onClick={sendMagic}
              disabled={loading || !email}
              className="w-full mt-4 py-3 rounded-xl bg-white text-black font-semibold disabled:opacity-50"
            >
              {loading ? "Sending..." : "Send magic link"}
            </button>
          </>
        )}
      </div>
    </main>
  );
}