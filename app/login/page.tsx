"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function LoginPage() {
  const sp = useSearchParams();
  const rawError = sp.get("error");
  const errorMsg = rawError ? decodeURIComponent(rawError) : "";
  const next = sp.get("next") || "/create";

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const sendMagic = async () => {
    setLoading(true);
    try {
      const supabase = supabaseBrowser();

      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
        next
      )}`;

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

        {sent ? (
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
