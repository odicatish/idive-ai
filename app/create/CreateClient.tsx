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
  videoUrl: string | null;
};

const USE_CASES = [
  {
    id: "business_spokesperson",
    label: "Business Spokesperson",
    desc: "Professional company representative for landing pages or websites.",
  },
  {
    id: "sales_outreach",
    label: "Sales Outreach",
    desc: "Short personalized video for prospecting and lead generation.",
  },
  {
    id: "founder_ceo",
    label: "Founder / CEO Message",
    desc: "Leadership style message communicating mission and vision.",
  },
  {
    id: "product_explainer",
    label: "Product Explainer",
    desc: "Clear explanation of how a product or feature works.",
  },
];

export default function CreateClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [phase, setPhase] = useState<Phase>("idle");
  const [presenter, setPresenter] = useState<Presenter | null>(null);

  const [prompt, setPrompt] = useState("");

  const [useCase, setUseCase] = useState("business_spokesperson");

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

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) redirectToLogin();
    })();
  }, [supabase]);

  useEffect(() => {
    if (phase !== "loading") return;
    setStepIndex(0);
    const i = setInterval(() => setStepIndex((p) => (p + 1) % steps.length), 900);
    return () => clearInterval(i);
  }, [phase, steps]);

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
        useCase,
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

  const createVideoJob = async () => {
    if (!presenter?.id) {
      alert("Missing presenter id.");
      return;
    }

    setJobBusy(true);
    setJobMsg("Creating video job...");
    setJob(null);

    try {
      const r = await postJSON("/api/video-jobs/create", { presenterId: presenter.id });

      const jobId = r?.job?.id;

      setJob({ id: jobId, status: "queued", progress: 0, error: null, videoUrl: null });

      await fetch("/api/video-jobs/run-worker", { method: "POST" });

      await pollJob(jobId);
    } catch (e: any) {
      alert(e?.message ?? "Failed.");
    } finally {
      setJobBusy(false);
    }
  };

  const pollJob = async (jobId: string) => {
    if (!presenter?.id) return;

    while (true) {
      const res = await fetch(
        `/api/presenters/${presenter.id}/video-status?jobId=${jobId}`,
        { cache: "no-store" }
      );

      const json = await res.json();

      const j = json?.job;

      if (j) {
        setJob({
          id: j.id,
          status: j.status,
          progress: j.progress,
          error: j.error,
          videoUrl: j.videoUrl ?? null,
        });
      }

      if (j?.status === "completed") {
        setJobMsg("Video ready");
        return;
      }

      await new Promise((r) => setTimeout(r, 1500));
    }
  };

  if (phase === "loading") {
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center text-white">
        <div className="w-20 h-20 border-2 border-white/20 border-t-white rounded-full animate-spin mb-8" />
        <p className="text-xl text-white/90">{steps[stepIndex]}</p>
      </div>
    );
  }

  if (phase === "result" && presenter) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-6 text-white">
        <div className="bg-neutral-900 rounded-3xl overflow-hidden shadow-2xl max-w-md w-full border border-neutral-800">
          {presenter.image && (
            <img src={presenter.image} className="w-full aspect-[3/4] object-cover" />
          )}

          <div className="p-8 text-center">
            <h2 className="text-3xl font-bold">{presenter.name}</h2>
            <p className="text-neutral-400">{presenter.title}</p>

            <button
              onClick={() => presenter?.id && router.push(`/studio/${presenter.id}`)}
              className="w-full mt-6 py-4 bg-white text-black rounded-xl font-semibold"
            >
              Enter Studio
            </button>

            <button
              onClick={createVideoJob}
              className="w-full mt-4 py-4 bg-neutral-800 rounded-xl font-semibold"
            >
              Generate Video
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-6">
      <div className="w-full max-w-4xl">

        <h1 className="text-5xl font-bold text-center mb-12">
          Identity Control Panel
        </h1>

        {/* USE CASE */}
        <div className="mb-12">
          <p className="text-neutral-400 mb-4">Video Type</p>

          <div className="grid md:grid-cols-2 gap-4">
            {USE_CASES.map((c) => (
              <button
                key={c.id}
                onClick={() => setUseCase(c.id)}
                className={`text-left border rounded-xl p-4 transition ${
                  useCase === c.id
                    ? "border-white bg-white text-black"
                    : "border-neutral-700 hover:border-neutral-400"
                }`}
              >
                <div className="font-semibold">{c.label}</div>
                <div className="text-sm opacity-70 mt-1">{c.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* PROMPT */}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the video..."
          className="w-full min-h-[120px] bg-black border border-neutral-700 rounded-xl p-4"
        />

        <button
          onClick={generateHuman}
          className="mt-8 w-full py-5 bg-white text-black rounded-2xl text-lg font-semibold"
        >
          Generate Synthetic Human
        </button>
      </div>
    </main>
  );
}