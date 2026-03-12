import Link from "next/link";

const USE_CASES = [
  {
    title: "Business Spokesperson",
    description:
      "Create presenter-led videos for landing pages, websites, and business communication.",
  },
  {
    title: "Sales Outreach",
    description:
      "Generate short presenter videos for prospecting, follow-up, and lead generation.",
  },
  {
    title: "Founder / CEO Message",
    description:
      "Communicate vision, leadership updates, and trust-building brand messages.",
  },
  {
    title: "Product Explainer",
    description:
      "Explain your product, feature, or flow in a clear presenter-led video.",
  },
];

const BENEFITS = [
  {
    title: "Built for business communication",
    description:
      "iDive AI is designed for real business use cases, not generic avatar demos.",
  },
  {
    title: "Script, presenter, voice, and render",
    description:
      "Generate the presenter, write the message, refine it in Studio, and render the final MP4 in one flow.",
  },
  {
    title: "Simple workflow",
    description:
      "No filming, no editing software, and no complicated production process.",
  },
];

const STEPS = [
  {
    step: "01",
    title: "Choose your video type",
    description:
      "Select the business use case that best matches the message you want to create.",
  },
  {
    step: "02",
    title: "Generate presenter and script",
    description:
      "Create an AI presenter with image, identity, and a first version of your script.",
  },
  {
    step: "03",
    title: "Edit in Studio",
    description:
      "Refine the message, adjust direction, and customize context, voice, and delivery.",
  },
  {
    step: "04",
    title: "Render your final MP4",
    description:
      "Export the final presenter video ready for your website, campaigns, or outreach.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white">
      <section className="px-6 pt-10 pb-20">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-between gap-4">
            <div className="inline-flex items-center rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs text-neutral-300">
              iDive AI
            </div>

            <Link
              href="/create"
              className="rounded-full border border-white/12 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Create Presenter
            </Link>
          </div>

          <div className="mx-auto max-w-4xl text-center pt-20">
            <h1 className="text-5xl md:text-7xl font-semibold tracking-tight leading-[1.02]">
              Your AI business spokesperson for high-conversion video communication.
            </h1>

            <p className="mt-8 text-lg md:text-xl text-neutral-400 leading-8 max-w-3xl mx-auto">
              Create polished presenter-led business videos for websites, product explainers,
              founder messages, and sales outreach — with AI-generated presenters, scripts,
              voice, and final MP4 render.
            </p>

            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/create"
                className="w-full sm:w-auto rounded-2xl bg-white px-8 py-4 text-black text-lg font-semibold transition hover:opacity-95"
              >
                Create your AI presenter
              </Link>

              <a
                href="#how-it-works"
                className="w-full sm:w-auto rounded-2xl border border-white/12 bg-white/5 px-8 py-4 text-lg font-semibold text-white transition hover:bg-white/10"
              >
                See how it works
              </a>
            </div>

            <div className="mt-16 grid gap-4 md:grid-cols-3 text-left">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5">
                <div className="text-sm font-medium text-white">Built for business use cases</div>
                <div className="mt-2 text-sm leading-6 text-neutral-400">
                  Presenter-led videos for websites, outreach, explainers, and leadership
                  communication.
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5">
                <div className="text-sm font-medium text-white">One simple workflow</div>
                <div className="mt-2 text-sm leading-6 text-neutral-400">
                  Generate presenter, script, voice, and final MP4 without switching tools.
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5">
                <div className="text-sm font-medium text-white">More useful than avatar demos</div>
                <div className="mt-2 text-sm leading-6 text-neutral-400">
                  Designed to create clear, credible business videos — not generic talking heads.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-white/6 px-6 py-20">
        <div className="mx-auto max-w-6xl grid gap-10 lg:grid-cols-[0.9fr_1.1fr] items-start">
          <div>
            <div className="text-sm uppercase tracking-[0.22em] text-neutral-500">The problem</div>
            <h2 className="mt-4 text-3xl md:text-4xl font-semibold tracking-tight">
              Business video is powerful — but hard to produce.
            </h2>
          </div>

          <div className="space-y-5 text-neutral-400 text-lg leading-8">
            <p>
              Creating professional presenter videos usually means cameras, editing, voiceover,
              and time-consuming production work.
            </p>
            <p>
              Most AI avatar tools do not really solve this either. They often feel generic,
              robotic, or disconnected from real business communication needs.
            </p>
            <p>
              Teams still need a faster way to create clear, credible video messages that are
              actually useful in marketing, sales, and product communication.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-white/6 px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <div className="text-sm uppercase tracking-[0.22em] text-neutral-500">The solution</div>
            <h2 className="mt-4 text-3xl md:text-4xl font-semibold tracking-tight">
              Create presenter-led business videos in one simple flow.
            </h2>
            <p className="mt-6 text-lg leading-8 text-neutral-400">
              iDive AI helps you create polished presenter videos built for real communication use
              cases — not generic avatar demos. Generate your presenter, write the script, refine
              the message, and render the final video in minutes.
            </p>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {BENEFITS.map((item) => (
              <div
                key={item.title}
                className="rounded-3xl border border-neutral-800 bg-neutral-950 p-6"
              >
                <h3 className="text-lg font-semibold">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-neutral-400">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-white/6 px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <div className="text-sm uppercase tracking-[0.22em] text-neutral-500">Use cases</div>
            <h2 className="mt-4 text-3xl md:text-4xl font-semibold tracking-tight">
              Built for the business videos teams actually need.
            </h2>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-2">
            {USE_CASES.map((item) => (
              <div
                key={item.title}
                className="rounded-3xl border border-neutral-800 bg-neutral-950 p-6"
              >
                <h3 className="text-xl font-semibold">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-neutral-400">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-t border-white/6 px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <div className="text-sm uppercase tracking-[0.22em] text-neutral-500">
              How it works
            </div>
            <h2 className="mt-4 text-3xl md:text-4xl font-semibold tracking-tight">
              From idea to final MP4 in four steps.
            </h2>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {STEPS.map((item) => (
              <div
                key={item.step}
                className="rounded-3xl border border-neutral-800 bg-neutral-950 p-6"
              >
                <div className="text-sm font-medium text-neutral-500">{item.step}</div>
                <h3 className="mt-4 text-lg font-semibold">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-neutral-400">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-white/6 px-6 py-20">
        <div className="mx-auto max-w-5xl rounded-[32px] border border-neutral-800 bg-neutral-950 px-8 py-12 md:px-12 md:py-16 text-center">
          <div className="text-sm uppercase tracking-[0.22em] text-neutral-500">Final CTA</div>
          <h2 className="mt-4 text-3xl md:text-5xl font-semibold tracking-tight">
            Create your first AI presenter video.
          </h2>
          <p className="mt-6 max-w-2xl mx-auto text-lg leading-8 text-neutral-400">
            Generate a business presenter, refine the message, and render your final video in one
            simple workflow.
          </p>

          <div className="mt-10">
            <Link
              href="/create"
              className="inline-flex rounded-2xl bg-white px-8 py-4 text-black text-lg font-semibold transition hover:opacity-95"
            >
              Create your AI presenter
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}