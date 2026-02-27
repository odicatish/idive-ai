"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Phase = "idle" | "loading" | "result";

type Presenter = {
  id?: string;
  name?: string;
  title?: string;
  bio?: string;
  script?: string;
  appearance?: string;
  image?: string | null;
  image_path?: string | null;
  prompt?: string | null;
};

type VideoJob = {
  id: string;
  status: string;
  progress: number;
  error: string | null;
  video_url: string | null;
};

export default function CreateClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [phase, setPhase] = useState<Phase>("idle");
  const [presenter, setPresenter] = useState<Presenter | null>(null);

  const [prompt, setPrompt] = useState("");

  // video job state
  const [job, setJob] = useState<VideoJob | null>(null);
  const [jobMsg, setJobMsg] = useState<string | null>(null);
  const [jobBusy, setJobBusy] = useState(false);

  const [gender, setGender] = useState("any");
  const [age, setAge] = useState("30-45");
  const [industry, setIndustry] = useState("business");
  const [energy, setEnergy] = useState("executive");
  const [style, setStyle] = useState("authoritative");

  const steps = useMemo(
    () => [
      "Scanning neural identity space...",
      "Designing facial geometry...",
      "Mapping behavioral intelligence...",
      "Synthesizing executive presence...",
      "Stabilizing synthetic human...",
    ],
    []
  );
  const [stepIndex, setStepIndex] = useState(0);

  const redirectToLogin = () => {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}`;
  };

  // session guard
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) redirectToLogin();
    })();
  }, [supabase]);

  // loader step text
  useEffect(() => {
    if (phase !== "loading") return;
    setStepIndex(0);
    const i = setInterval(() => setStepIndex((p) => (p + 1) % steps.length), 900);
    return () => clearInterval(i);
  }, [phase, steps]);

  // After Stripe redirect: poll /api/stripe/status (păstrez cum îl aveai)
  useEffect(() => {
    const checkout = searchParams.get("checkout");
    if (checkout !== "success") return;

    let alive = true;

    (async () => {
      try {
        for (let i = 0; i < 10; i++) {
          const res = await fetch("/api/stripe/status", { method: "GET" });

          if (res.status === 401) {
            redirectToLogin();
            return;
          }

          const status = await res.json();
          if (status?.pro) break;

          await new Promise((r) => setTimeout(r, 1500));
          if (!alive) return;
        }
      } catch {
        // ignore
      } finally {
        router.replace("/create");
      }
    })();

    return () => {
      alive = false;
    };
  }, [searchParams, router]);

  const postJSON = async (url: string, body?: any) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : "{}",
    });

    if (res.status === 401) {
      redirectToLogin();
      return null;
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`API failed: ${res.status} ${txt}`);
    }

    return res.json();
  };

  // generate presenter (same)
  const generateHuman = async () => {
    setJob(null);
    setJobMsg(null);

    setPhase("loading");
    try {
      const data = await postJSON("/api/generate-script", {
        gender,
        age,
        industry,
        energy,
        style,
        prompt,
      });

      if (!data) return;

      setPresenter(data);
      setPhase("result");
    } catch (e) {
      console.error(e);
      alert("Generate failed — check logs.");
      setPhase("idle");
    }
  };

  // --- VIDEO JOB FLOW ---
  const createVideoJob = async () => {
    if (!presenter?.id) {
      alert("Missing presenter id. Generate first.");
      return;
    }

    setJobBusy(true);
    setJobMsg("Creating video job...");
    setJob(null);

    try {
      // 1) create job (server will pick latest script for presenter)
      const r = await postJSON("/api/video-jobs/create", { presenterId: presenter.id });
      if (!r) return;

      const jobId = r?.job?.id as string | undefined;
      if (!jobId) throw new Error("Missing job.id from /api/video-jobs/create");

      setJobMsg("Job created. Triggering worker...");
      setJob({ id: jobId, status: "queued", progress: 0, error: null, video_url: null });

      // 2) try trigger worker (server-side, secret not exposed)
      // if this fails, cron will still run later, but ideally this works now
      try {
        await fetch("/api/video-jobs/run-worker", { method: "POST" });
      } catch {}

      // 3) start polling
      await pollJob(jobId);
    } catch (e: any) {
      console.error(e);
      setJobMsg(null);
      alert(e?.message ?? "Failed to create job.");
    } finally {
      setJobBusy(false);
    }
  };

  const pollJob = async (jobId: string) => {
    setJobMsg("Processing...");

    let alive = true;
    const stopAfterMs = 2 * 60 * 1000; // 2 min
    const start = Date.now();

    while (alive) {
      const res = await fetch(`/api/video-jobs/${jobId}`, { method: "GET" });

      if (res.status === 401) {
        redirectToLogin();
        return;
      }

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        // show error payload
        const msg = json?.error ? String(json.error) : `Status ${res.status}`;
        setJobMsg(`Error: ${msg}`);
        return;
      }

      const j = json?.job as any;
      if (j) {
        setJob({
          id: j.id,
          status: j.status,
          progress: j.progress ?? 0,
          error: j.error ?? null,
          video_url: j.video_url ?? null,
        });
      }

      // stop conditions
      if (j?.status === "completed") {
        setJobMsg("✅ Video ready.");
        return;
      }
      if (j?.status === "failed" || j?.error) {
        setJobMsg(`❌ Failed: ${j?.error ?? "unknown"}`);
        return;
      }

      if (Date.now() - start > stopAfterMs) {
        setJobMsg("Still processing. Leave this tab open or refresh later.");
        return;
      }

      await new Promise((r) => setTimeout(r, 1500));
    }

    return () => {
      alive = false;
    };
  };

  // UI: Loading
  if (phase === "loading") {
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center text-white">
        <div className="w-20 h-20 border-2 border-white/20 border-t-white rounded-full animate-spin mb-8" />
        <p className="text-xl text-white/90">{steps[stepIndex]}</p>
        <button
          onClick={() => setPhase("idle")}
          className="mt-6 text-sm text-white/40 hover:text-white/70 underline"
        >
          Back
        </button>
      </div>
    );
  }

  // UI: Result
  if (phase === "result" && presenter) {
    const pct = job?.progress ?? 0;

    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-6 text-white">
        <div className="bg-neutral-900 rounded-3xl overflow-hidden shadow-2xl max-w-md w-full border border-neutral-800">
          {presenter.image && (
            <img
              src={presenter.image}
              className="w-full aspect-[3/4] object-cover"
              alt="Presenter"
              onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
            />
          )}

          <div className="p-8 text-center">
            <h2 className="text-3xl font-bold">{presenter.name}</h2>
            <p className="text-neutral-400">{presenter.title}</p>

            {presenter.bio && (
              <p className="text-sm text-neutral-300 mt-4 leading-relaxed">{presenter.bio}</p>
            )}

            {presenter.script && (
              <div className="mt-5 text-left bg-black/30 border border-neutral-800 rounded-2xl p-4">
                <p className="text-xs uppercase tracking-wider text-neutral-400 mb-2">
                  Script (preview)
                </p>
                <p className="text-sm text-neutral-200 whitespace-pre-wrap leading-relaxed">
                  {presenter.script}
                </p>
              </div>
            )}

            {/* Studio */}
            <button
              onClick={() => presenter?.id && router.push(`/studio/${presenter.id}`)}
              className="w-full mt-6 py-4 bg-white text-black rounded-xl font-semibold hover:scale-[1.02] transition"
            >
              Enter Studio
            </button>

            <div className="h-px bg-neutral-800 my-6" />

            {/* Video job UI */}
            {!!jobMsg && (
              <div className="text-sm text-neutral-200 bg-black/30 border border-neutral-800 rounded-2xl p-4 mb-4">
                {jobMsg}
              </div>
            )}

            {job && (
              <div className="mb-4 text-left bg-black/30 border border-neutral-800 rounded-2xl p-4">
                <div className="flex items-center justify-between text-xs text-neutral-400">
                  <span>Status: {job.status}</span>
                  <span>{pct}%</span>
                </div>
                <div className="mt-2 h-2 w-full bg-neutral-800 rounded-full overflow-hidden">
                  <div className="h-2 bg-white" style={{ width: `${pct}%` }} />
                </div>

                {job.video_url && (
                  <a
                    href={job.video_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-block text-sm underline text-white/90 hover:text-white"
                  >
                    Open video
                  </a>
                )}
              </div>
            )}

            <button
              onClick={createVideoJob}
              disabled={jobBusy}
              className="w-full py-4 bg-neutral-800 rounded-xl font-semibold hover:bg-neutral-700 transition disabled:opacity-60"
            >
              {jobBusy ? "Working..." : "🎬 Generate Video"}
            </button>

            <button
              onClick={() => {
                setPhase("idle");
                setPresenter(null);
                setJob(null);
                setJobMsg(null);
              }}
              className="mt-4 w-full py-3 bg-neutral-800 rounded-xl font-semibold hover:bg-neutral-700 transition"
            >
              Generate Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  // UI: Control Panel
  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-6">
      <div className="w-full max-w-4xl">
        <h1 className="text-5xl font-bold text-center mb-12">Identity Control Panel</h1>

        <div className="mb-10">
          <p className="text-neutral-400 mb-3">Tema / detalii pentru script (opțional)</p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder='Ex: "Pitch de 30s pentru un SaaS, ton premium, call-to-action"'
            className="w-full min-h-[110px] px-4 py-3 rounded-2xl bg-black/30 border border-neutral-700 outline-none focus:border-neutral-400 text-white"
          />
          <p className="text-xs text-neutral-500 mt-2">
            Dacă lași gol, AI-ul generează generic pe industria selectată.
          </p>
        </div>

        <div className="grid gap-8">
          <Selector label="Gender" options={["male", "female", "any"]} value={gender} setValue={setGender} />
          <Selector label="Age Range" options={["20-30", "30-45", "45-60"]} value={age} setValue={setAge} />
          <Selector
            label="Industry"
            options={["business", "technology", "fitness", "finance", "education"]}
            value={industry}
            setValue={setIndustry}
          />
          <Selector label="Energy" options={["calm", "executive", "charismatic", "dominant"]} value={energy} setValue={setEnergy} />
          <Selector
            label="Communication Style"
            options={["authoritative", "friendly", "inspiring", "strategic"]}
            value={style}
            setValue={setStyle}
          />
        </div>

        <button
          onClick={generateHuman}
          className="mt-12 w-full py-5 bg-white text-black rounded-2xl text-lg font-semibold hover:scale-105 transition"
        >
          Generate Synthetic Human
        </button>
      </div>
    </main>
  );
}

function Selector({
  label,
  options,
  value,
  setValue,
}: {
  label: string;
  options: string[];
  value: string;
  setValue: (v: string) => void;
}) {
  return (
    <div>
      <p className="text-neutral-400 mb-3">{label}</p>
      <div className="flex gap-3 flex-wrap">
        {options.map((option) => (
          <button
            key={option}
            onClick={() => setValue(option)}
            className={`px-4 py-2 rounded-full border transition ${
              value === option
                ? "bg-white text-black border-white"
                : "border-neutral-700 hover:border-neutral-400"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}