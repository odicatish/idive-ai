"use client";

import { useState } from "react";

export default function RunWorkerButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/admin/run-worker", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);

      setResult(json);
    } catch (e: any) {
      setError(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <button
        onClick={run}
        disabled={loading}
        className="w-full py-3 rounded-xl bg-white text-black font-semibold disabled:opacity-50"
      >
        {loading ? "Running..." : "Run worker once"}
      </button>

      {error ? (
        <div className="text-sm text-red-300 bg-red-900/20 border border-red-800 rounded-xl p-3">
          {error}
        </div>
      ) : null}

      {result ? (
        <pre className="text-xs whitespace-pre-wrap break-words text-neutral-200 bg-black/30 border border-neutral-800 rounded-xl p-3">
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}