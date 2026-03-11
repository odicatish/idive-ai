"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
    desc: "Professional presenter for landing pages, websites, and brand videos.",
  },
  {
    id: "sales_outreach",
    label: "Sales Outreach",
    desc: "Short business video for prospecting, follow-up, or lead generation.",
  },
  {
    id: "founder_ceo",
    label: "Founder / CEO Message",
    desc: "Leadership message for trust, vision, and brand authority.",
  },
  {
    id: "product_explainer",
    label: "Product Explainer",
    desc: "Clear presenter video explaining product value, features, or flow.",
  },
] as const;

const GENDER_OPTIONS = [
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
  { id: "any", label: "Any" },
] as const;

function getPromptPlaceholder(useCase: string) {
  switch (useCase) {
    case "sales_outreach":
      return "Example: Create a short outreach video for a SaaS company helping sales teams send AI personalized follow-ups after demos. Keep it direct, credible, and easy to respond to.";
    case "founder_ceo":
      return "Example: Create a founder message for a B2B AI company focused on helping teams communicate product value more clearly. Tone should feel calm, credible, and leadership-driven.";
    case "product_explainer":
      return "Example: Create a product explainer for a tool that turns product updates into short presenter videos for websites and campaigns. Make it clear, simple, and benefit-led.";
    case "business_spokesperson":
    default:
      return "Example: Create a business spokesperson video for a company offering AI video presenters for landing pages, explainers, and business communication. Keep it polished and premium.";
  }
}

function getUseCaseHint(useCase: string) {
  switch (useCase) {
    case "sales_outreach":
      return "Best for short, direct videos that open interest and drive replies.";
    case "founder_ceo":
      return "Best for trust, authority, company vision, and executive communication.";
    case "product_explainer":
      return "Best for explaining what your product does and why it matters.";
    case "business_spokesperson":
    default:
      return "Best for homepage, landing page, and polished business presentation videos.";
  }
}

export default function CreateClient() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [phase, setPhase] = useState<Phase>("idle");
  const [presenter, setPresenter] = useState<Presenter | null>(null);

  const [prompt, setPrompt] = useState("");

  const [useCase, setUseCase] = useState("business_spokesperson");

  const [job, setJob] = useState<VideoJob | null>(null);
  const [jobMsg, setJobMsg] = useState<string | null>(null);
  const [jobBusy, setJobBusy] = useState(false);

  const [gender, setGender] = useState("any");
  const [age] = useState("30-45");
  const [industry] = useState("business");
  const [energy] = useState("executive");
  const [style] = useState("authoritative");

  const loadingSteps = useMemo(
    () => [
      "Defining presenter profile...",
      "Generating presenter identity...",
      "Writing camera-ready script...",
      "Preparing studio assets...",
      "Finalizing your presenter...",
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
    const i = setInterval(() => setStepIndex((p) => (p + 1) % loadingSteps.length), 1000);
    return () => clearInterval(i);
  }, [phase, loadingSteps]);

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
      if (!jobId) throw new Error("Missing job id.");

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
      const res = await fetch(`/api/presenters/${presenter.id}/video-status?jobId=${jobId}`, {
        cache: "no-store",
      });

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

      if (j?.status === "failed") {
        setJobMsg(j?.error || "Video job failed");
        return;
      }

      await new Promise((r) => setTimeout(r, 1500));
    }
  };

  if (phase === "loading") {
    return (
      <div className="fixed inset-0 bg-black text-white flex flex-col items-center justify-center px-6">
        <div className="w-20 h-20 border-2 border-white/20 border-t-white rounded-full animate-spin mb-8" />
        <p className="text-xl text-white/95 text-center">{loadingSteps[stepIndex]}</p>
        <p className="mt-3 text-sm text-neutral-500 text-center">
          This usually takes a moment.
        </p>
      </div>
    );
  }

  if (phase === "result" && presenter) {
    return (
      <div className="min-h-screen bg-black text-white px-6 py-10">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8">
            <button
              onClick={() => {
                setPhase("idle");
                setPresenter(null);
                setJob(null);
                setJobMsg(null);
              }}
              className="text-sm text-neutral-400 hover:text-white transition"
            >
              ← Back to create
            </button>
          </div>

          <div className="grid gap-8 lg:grid-cols-[420px_minmax(0,1fr)] items-start">
            <div className="bg-neutral-900 rounded-3xl overflow-hidden border border-neutral-800 shadow-2xl">
              {presenter.image ? (
                <img
                  src={presenter.image}
                  className="w-full aspect-[3/4] object-cover"
                  alt="Presenter"
                />
              ) : (
                <div className="w-full aspect-[3/4] bg-neutral-950 flex items-center justify-center text-neutral-500">
                  Presenter image
                </div>
              )}
            </div>

            <div className="bg-neutral-950 border border-neutral-800 rounded-3xl p-8">
              <div className="inline-flex items-center rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300">
                {USE_CASES.find((x) => x.id === useCase)?.label || "Presenter"}
              </div>

              <h1 className="mt-4 text-4xl font-semibold tracking-tight">
                {presenter.name || "Your presenter is ready"}
              </h1>

              {presenter.title && (
                <p className="mt-2 text-lg text-neutral-400">{presenter.title}</p>
              )}

              {presenter.bio && (
                <p className="mt-6 text-neutral-300 leading-7">{presenter.bio}</p>
              )}

              {presenter.script && (
                <div className="mt-8 rounded-2xl border border-neutral-800 bg-black/40 p-5">
                  <div className="text-sm font-medium text-neutral-200 mb-2">Generated script</div>
                  <p className="text-sm leading-7 text-neutral-400 line-clamp-6">
                    {presenter.script}
                  </p>
                </div>
              )}

              <div className="mt-8 flex flex-col sm:flex-row gap-4">
                <button
                  onClick={() => presenter?.id && router.push(`/studio/${presenter.id}`)}
                  className="flex-1 py-4 bg-white text-black rounded-2xl font-semibold hover:opacity-95 transition"
                >
                  Enter Studio
                </button>

                <button
                  onClick={createVideoJob}
                  disabled={jobBusy}
                  className="flex-1 py-4 bg-neutral-800 rounded-2xl font-semibold disabled:opacity-60 hover:bg-neutral-700 transition"
                >
                  {jobBusy ? "Working..." : "Generate Video"}
                </button>
              </div>

              {jobMsg && <div className="mt-5 text-sm text-neutral-300">{jobMsg}</div>}

              {job && (
                <div className="mt-4 rounded-2xl border border-neutral-800 bg-black/30 p-4 text-left">
                  <div className="flex items-center justify-between text-xs text-neutral-400">
                    <span>Status: {job.status}</span>
                    <span>{job.progress}%</span>
                  </div>

                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-800">
                    <div className="h-2 bg-white" style={{ width: `${job.progress}%` }} />
                  </div>

                  {job.error && <div className="mt-3 text-sm text-red-300">{job.error}</div>}

                  {job.videoUrl && (
                    <a
                      href={job.videoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-block text-sm underline text-white/90 hover:text-white"
                    >
                      Open video
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const selectedUseCase = USE_CASES.find((c) => c.id === useCase);

  return (
    <main className="min-h-screen bg-black text-white px-6 py-12">
      <div className="mx-auto max-w-5xl">
        <div className="max-w-3xl">
          <div className="inline-flex items-center rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs text-neutral-300">
            iDive AI
          </div>

          <h1 className="mt-6 text-5xl md:text-6xl font-semibold tracking-tight">
            Create an AI business presenter
          </h1>

          <p className="mt-5 text-lg text-neutral-400 leading-8">
            Generate a presenter with image, identity, and camera-ready script for business videos.
          </p>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-neutral-800 bg-neutral-950 p-8">
            <div>
              <div className="text-sm font-medium text-neutral-300">1. Choose video type</div>
              <p className="mt-2 text-sm text-neutral-500">
                Pick the use case that best matches the video you want to create.
              </p>

              <div className="mt-5 grid md:grid-cols-2 gap-4">
                {USE_CASES.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setUseCase(c.id)}
                    className={`text-left rounded-2xl border p-4 transition ${
                      useCase === c.id
                        ? "border-white bg-white text-black"
                        : "border-neutral-800 bg-black hover:border-neutral-600"
                    }`}
                  >
                    <div className="font-semibold">{c.label}</div>
                    <div className="text-sm opacity-75 mt-1 leading-6">{c.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-8">
              <div className="text-sm font-medium text-neutral-300">2. Choose presenter gender</div>
              <p className="mt-2 text-sm text-neutral-500">
                Keep it broad with Any, or choose a specific direction.
              </p>

              <div className="mt-5 flex flex-wrap gap-3">
                {GENDER_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setGender(option.id)}
                    className={`px-4 py-2 rounded-full border transition ${
                      gender === option.id
                        ? "bg-white text-black border-white"
                        : "border-neutral-700 hover:border-neutral-500"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-8">
              <div className="text-sm font-medium text-neutral-300">3. Describe your video</div>
              <p className="mt-2 text-sm text-neutral-500">
                Add business context, what you offer, who it is for, and the tone you want.
              </p>

              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={getPromptPlaceholder(useCase)}
                className="mt-5 w-full min-h-[180px] resize-y bg-black border border-neutral-800 rounded-2xl p-4 text-white placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-white/30"
              />
            </div>

            <button
              onClick={generateHuman}
              className="mt-8 w-full py-5 bg-white text-black rounded-2xl text-lg font-semibold hover:opacity-95 transition"
            >
              Generate Presenter
            </button>
          </div>

          <div className="rounded-3xl border border-neutral-800 bg-neutral-950 p-8 h-fit">
            <div className="text-sm font-medium text-neutral-300">Selected direction</div>

            <h2 className="mt-4 text-2xl font-semibold">
              {selectedUseCase?.label || "Business Spokesperson"}
            </h2>

            <p className="mt-3 text-neutral-400 leading-7">
              {selectedUseCase?.desc}
            </p>

            <div className="mt-6 rounded-2xl border border-neutral-800 bg-black/40 p-5">
              <div className="text-sm font-medium text-neutral-300">Why use this</div>
              <p className="mt-2 text-sm text-neutral-400 leading-7">
                {getUseCaseHint(useCase)}
              </p>
            </div>

            <div className="mt-6 rounded-2xl border border-neutral-800 bg-black/40 p-5">
              <div className="text-sm font-medium text-neutral-300">What you get</div>
              <ul className="mt-3 space-y-3 text-sm text-neutral-400">
                <li>AI presenter image and identity</li>
                <li>Script tailored to the selected business use case</li>
                <li>Direct handoff into Studio for editing and render</li>
              </ul>
            </div>

            <div className="mt-6 rounded-2xl border border-neutral-800 bg-black/40 p-5">
              <div className="text-sm font-medium text-neutral-300">Good prompt inputs</div>
              <p className="mt-2 text-sm text-neutral-400 leading-7">
                Include your company type, offer, target audience, desired tone, and what action
                you want the viewer to take.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}