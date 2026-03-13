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
      return "Example: Create a short sales outreach video for a SaaS company that helps sales teams send AI-powered follow-ups after demos. Mention the problem, the value, who it is for, and end with a simple reply CTA. Keep it direct, credible, and easy to respond to.";
    case "founder_ceo":
      return "Example: Create a founder message for a B2B AI company helping teams communicate product value more clearly. The goal is to build trust, explain the company direction, and sound calm, credible, and leadership-driven.";
    case "product_explainer":
      return "Example: Create a product explainer for a tool that turns product updates into short presenter videos for websites and campaigns. Explain what it does, who it helps, why it matters, and keep the tone clear and benefit-led.";
    case "business_spokesperson":
    default:
      return "Example: Create a business spokesperson video for a company offering AI video presenters for landing pages, product explainers, and business communication. Explain the offer clearly, who it is for, and keep the tone polished and premium.";
  }
}

function getUseCaseHint(useCase: string) {
  switch (useCase) {
    case "sales_outreach":
      return "Best for short, direct videos that open interest, create relevance, and drive replies.";
    case "founder_ceo":
      return "Best for trust, authority, company vision, leadership communication, and brand credibility.";
    case "product_explainer":
      return "Best for explaining what your product does, why it matters, and how it helps the customer.";
    case "business_spokesperson":
    default:
      return "Best for homepage, landing page, website, and polished business presentation videos.";
  }
}

function getUseCaseOutcome(useCase: string) {
  switch (useCase) {
    case "sales_outreach":
      return "A short presenter-led outreach video designed to make the first message clearer and more personal.";
    case "founder_ceo":
      return "A founder-style presenter video designed to communicate trust, vision, and executive clarity.";
    case "product_explainer":
      return "A presenter-led explainer video designed to make your product easier to understand and easier to buy.";
    case "business_spokesperson":
    default:
      return "A polished presenter-led business video designed for websites, landing pages, and brand communication.";
  }
}

function getPromptChecklist(useCase: string) {
  switch (useCase) {
    case "sales_outreach":
      return [
        "What your company offers",
        "Who the target company or buyer is",
        "Why they should care now",
        "What action you want them to take",
      ];
    case "founder_ceo":
      return [
        "What the company does",
        "What message or update you want to communicate",
        "Who the audience is",
        "What tone should the presenter use",
      ];
    case "product_explainer":
      return [
        "What the product does",
        "Who it helps",
        "What problem it solves",
        "What the main value or CTA is",
      ];
    case "business_spokesperson":
    default:
      return [
        "What your company offers",
        "Who the audience is",
        "What makes the offer valuable",
        "What action the viewer should take",
      ];
  }
}

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
  const [age] = useState("30-45");
  const [industry] = useState("business");
  const [energy] = useState("executive");
  const [style] = useState("authoritative");

  const [generateError, setGenerateError] = useState<string | null>(null);

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

  const checkoutState = searchParams.get("checkout");
  const checkoutPlan = searchParams.get("plan");

  const selectedUseCase = USE_CASES.find((c) => c.id === useCase);
  const promptChecklist = getPromptChecklist(useCase);
  const canGenerate = prompt.trim().length >= 20;

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
    if (!canGenerate) {
      setGenerateError(
        "Add a bit more detail about your company, audience, offer, and desired outcome before generating."
      );
      return;
    }

    setGenerateError(null);
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
      <div className="fixed inset-0 overflow-hidden bg-black text-white">
        <video
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 h-full w-full object-cover opacity-30"
        >
          <source src="/backgrounds/generate.mp4" type="video/mp4" />
        </video>

        <div className="absolute inset-0 bg-black/65" />

        <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
          <div className="mb-8 h-20 w-20 animate-spin rounded-full border-2 border-white/20 border-t-white" />
          <p className="text-center text-xl text-white/95">{loadingSteps[stepIndex]}</p>
          <p className="mt-3 text-center text-sm text-neutral-400">
            This usually takes a moment.
          </p>
        </div>
      </div>
    );
  }

  if (phase === "result" && presenter) {
    return (
      <div className="min-h-screen bg-black px-6 py-10 text-white">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8">
            <button
              onClick={() => {
                setPhase("idle");
                setPresenter(null);
                setJob(null);
                setJobMsg(null);
              }}
              className="text-sm text-neutral-400 transition hover:text-white"
            >
              ← Back to create
            </button>
          </div>

          <div className="grid items-start gap-8 lg:grid-cols-[420px_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-900 shadow-2xl">
              {presenter.image ? (
                <img
                  src={presenter.image}
                  className="aspect-[3/4] w-full object-cover"
                  alt="Presenter"
                />
              ) : (
                <div className="flex aspect-[3/4] w-full items-center justify-center bg-neutral-950 text-neutral-500">
                  Presenter image
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-neutral-800 bg-neutral-950 p-8">
              <div className="inline-flex items-center rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300">
                {USE_CASES.find((x) => x.id === useCase)?.label || "Presenter"}
              </div>

              <h1 className="mt-4 text-4xl font-semibold tracking-tight">
                {presenter.name || "Your presenter is ready"}
              </h1>

              <p className="mt-3 text-sm leading-7 text-neutral-400">
                Your presenter, identity, and initial script are ready. Enter Studio to refine the
                message, context, voice, and video direction before rendering the final MP4.
              </p>

              {presenter.title && (
                <p className="mt-4 text-lg text-neutral-400">{presenter.title}</p>
              )}

              {presenter.bio && (
                <p className="mt-6 leading-7 text-neutral-300">{presenter.bio}</p>
              )}

              {presenter.script && (
                <div className="mt-8 rounded-2xl border border-neutral-800 bg-black/40 p-5">
                  <div className="mb-2 text-sm font-medium text-neutral-200">Generated script</div>
                  <p className="line-clamp-6 text-sm leading-7 text-neutral-400">
                    {presenter.script}
                  </p>
                </div>
              )}

              <div className="mt-8 grid gap-3 rounded-2xl border border-neutral-800 bg-black/30 p-5 text-sm text-neutral-300">
                <div>Next best step: open Studio and refine the message before rendering.</div>
                <div>Use direct video generation only when you are ready to render immediately.</div>
              </div>

              <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                <button
                  onClick={() => presenter?.id && router.push(`/studio/${presenter.id}`)}
                  className="flex-1 rounded-2xl bg-white py-4 font-semibold text-black transition hover:opacity-95"
                >
                  Enter Studio
                </button>

                <button
                  onClick={createVideoJob}
                  disabled={jobBusy}
                  className="flex-1 rounded-2xl bg-neutral-800 py-4 font-semibold transition hover:bg-neutral-700 disabled:opacity-60"
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
                      className="mt-3 inline-block text-sm text-white/90 underline hover:text-white"
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

  return (
    <main className="min-h-screen bg-black px-6 py-12 text-white">
      <div className="mx-auto max-w-5xl">
        {(checkoutState === "success" || checkoutState === "cancel") && (
          <div className="mb-8 rounded-3xl border border-neutral-800 bg-neutral-950 p-5">
            {checkoutState === "success" ? (
              <>
                <div className="text-sm font-semibold text-emerald-300">
                  Subscription updated
                </div>
                <div className="mt-2 text-sm leading-7 text-neutral-300">
                  Your checkout completed successfully
                  {checkoutPlan ? ` for the ${checkoutPlan} plan` : ""}. You can continue creating
                  presenters and use your updated plan inside Studio.
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-semibold text-neutral-200">Checkout canceled</div>
                <div className="mt-2 text-sm leading-7 text-neutral-400">
                  No problem. You can keep using the current workflow and upgrade later whenever you
                  need more monthly video capacity.
                </div>
              </>
            )}
          </div>
        )}

        <div className="max-w-3xl">
          <div className="inline-flex items-center rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs text-neutral-300">
            iDive AI
          </div>

          <h1 className="mt-6 text-5xl font-semibold tracking-tight md:text-6xl">
            Create an AI business presenter
          </h1>

          <p className="mt-5 text-lg leading-8 text-neutral-400">
            Generate a presenter with identity, image, and camera-ready script for business videos
            built around real use cases like websites, explainers, founder communication, and sales
            outreach.
          </p>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-neutral-800 bg-neutral-950 p-8">
            <div>
              <div className="text-sm font-medium text-neutral-300">1. Choose video type</div>
              <p className="mt-2 text-sm text-neutral-500">
                Pick the business use case that best matches the video you want to create.
              </p>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {USE_CASES.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setUseCase(c.id)}
                    className={`rounded-2xl border p-4 text-left transition ${
                      useCase === c.id
                        ? "border-white bg-white text-black"
                        : "border-neutral-800 bg-black hover:border-neutral-600"
                    }`}
                  >
                    <div className="font-semibold">{c.label}</div>
                    <div className="mt-1 text-sm leading-6 opacity-75">{c.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-8">
              <div className="text-sm font-medium text-neutral-300">2. Choose presenter gender</div>
              <p className="mt-2 text-sm text-neutral-500">
                Keep it flexible with Any, or choose a more specific visual direction.
              </p>

              <div className="mt-5 flex flex-wrap gap-3">
                {GENDER_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setGender(option.id)}
                    className={`rounded-full border px-4 py-2 transition ${
                      gender === option.id
                        ? "border-white bg-white text-black"
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
                Add your company context, offer, target audience, tone, and desired outcome. Better
                input usually leads to a better presenter and stronger first script.
              </p>

              <textarea
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  if (generateError) setGenerateError(null);
                }}
                placeholder={getPromptPlaceholder(useCase)}
                className="mt-5 min-h-[220px] w-full resize-y rounded-2xl border border-neutral-800 bg-black p-4 text-white placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-white/30"
              />

              <div className="mt-3 flex flex-col gap-2 text-xs text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  Prompt guidance: mention the company, audience, value, and desired call to action.
                </span>
                <span>{prompt.trim().length} characters</span>
              </div>

              {generateError && <div className="mt-3 text-sm text-amber-300">{generateError}</div>}
            </div>

            <button
              onClick={generateHuman}
              disabled={!canGenerate}
              className={`mt-8 w-full rounded-2xl py-5 text-lg font-semibold transition ${
                canGenerate
                  ? "bg-white text-black hover:opacity-95"
                  : "cursor-not-allowed bg-white/15 text-white/45"
              }`}
            >
              Generate Presenter
            </button>

            <div className="mt-4 text-center text-sm text-neutral-500">
              You will generate the presenter first, then refine everything in Studio.
            </div>
          </div>

          <div className="h-fit rounded-3xl border border-neutral-800 bg-neutral-950 p-8">
            <div className="text-sm font-medium text-neutral-300">Selected direction</div>

            <h2 className="mt-4 text-2xl font-semibold">
              {selectedUseCase?.label || "Business Spokesperson"}
            </h2>

            <p className="mt-3 leading-7 text-neutral-400">{selectedUseCase?.desc}</p>

            <div className="mt-6 rounded-2xl border border-neutral-800 bg-black/40 p-5">
              <div className="text-sm font-medium text-neutral-300">Why use this</div>
              <p className="mt-2 text-sm leading-7 text-neutral-400">{getUseCaseHint(useCase)}</p>
            </div>

            <div className="mt-6 rounded-2xl border border-neutral-800 bg-black/40 p-5">
              <div className="text-sm font-medium text-neutral-300">Expected outcome</div>
              <p className="mt-2 text-sm leading-7 text-neutral-400">{getUseCaseOutcome(useCase)}</p>
            </div>

            <div className="mt-6 rounded-2xl border border-neutral-800 bg-black/40 p-5">
              <div className="text-sm font-medium text-neutral-300">Good prompt inputs</div>
              <ul className="mt-3 space-y-3 text-sm text-neutral-400">
                {promptChecklist.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </div>

            <div className="mt-6 rounded-2xl border border-neutral-800 bg-black/40 p-5">
              <div className="text-sm font-medium text-neutral-300">What you get</div>
              <ul className="mt-3 space-y-3 text-sm text-neutral-400">
                <li>AI presenter image and identity</li>
                <li>Script tailored to the selected business use case</li>
                <li>Direct handoff into Studio for script editing and render</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}