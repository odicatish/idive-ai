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
    title: "Positioned for business use cases",
    description:
      "iDive AI is built for websites, product explainers, founder communication, and outreach — not generic avatar demos with weak positioning.",
  },
  {
    title: "Presenter, script, voice, and final render",
    description:
      "Generate the presenter, shape the message, refine everything in Studio, and export the final MP4 in one focused workflow.",
  },
  {
    title: "Faster than traditional production",
    description:
      "Skip filming, editing toolchains, and long revision loops when you need a polished business video quickly.",
  },
];

const STEPS = [
  {
    step: "01",
    title: "Choose the business video type",
    description:
      "Start with the use case that matches your goal: spokesperson, outreach, founder message, or product explainer.",
  },
  {
    step: "02",
    title: "Generate your AI presenter",
    description:
      "Create a presenter with the right identity, look, and business direction for the message you want to publish.",
  },
  {
    step: "03",
    title: "Refine everything in Studio",
    description:
      "Edit the script, update business context, tune voice and direction, and prepare the final message before rendering.",
  },
  {
    step: "04",
    title: "Render the final MP4",
    description:
      "Export a finished presenter video for your website, campaigns, product pages, or sales workflow.",
  },
];

const SOCIAL_PROOF = [
  "Landing page videos",
  "Product explainers",
  "Founder updates",
  "Sales outreach clips",
];

const OUTCOMES = [
  "Explain your product faster",
  "Increase trust on your website",
  "Ship founder messages without filming",
  "Create repeatable outreach video workflows",
];

export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white">
      <section className="px-6 pt-8 pb-20">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-between gap-4">
            <div className="inline-flex items-center rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs text-neutral-300">
              iDive AI
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/create"
                className="rounded-full border border-white/12 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Create Presenter
              </Link>
            </div>
          </div>

          <div className="mx-auto max-w-5xl pt-20 text-center">
            <div className="inline-flex items-center rounded-full border border-purple-400/20 bg-purple-500/10 px-4 py-2 text-xs font-medium text-purple-200">
              AI business presenter videos for websites, explainers, outreach, and founder updates
            </div>

            <h1 className="mt-8 text-5xl font-semibold leading-[1.02] tracking-tight md:text-7xl">
              Create AI business presenter videos without filming a production team video every time.
            </h1>

            <p className="mx-auto mt-8 max-w-3xl text-lg leading-8 text-neutral-400 md:text-xl">
              iDive AI helps teams create presenter-led business videos with AI-generated presenter,
              script, voice, and final MP4 render — in one workflow built for real business use
              cases, not generic avatar output.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                href="/create"
                className="w-full rounded-2xl bg-white px-8 py-4 text-lg font-semibold text-black transition hover:opacity-95 sm:w-auto"
              >
                Create your first presenter
              </Link>

              <a
                href="#pricing-preview"
                className="w-full rounded-2xl border border-white/12 bg-white/5 px-8 py-4 text-lg font-semibold text-white transition hover:bg-white/10 sm:w-auto"
              >
                See plans
              </a>
            </div>

            <div className="mt-12 text-sm text-neutral-500">
              Free plan available • 1 video / month • no filming setup required
            </div>

            <div className="mt-16 grid gap-4 text-left md:grid-cols-3">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5">
                <div className="text-sm font-medium text-white">Business-first output</div>
                <div className="mt-2 text-sm leading-6 text-neutral-400">
                  Built for teams that need product, spokesperson, and outreach videos that feel
                  usable in real funnels.
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5">
                <div className="text-sm font-medium text-white">Fast creation workflow</div>
                <div className="mt-2 text-sm leading-6 text-neutral-400">
                  Go from business idea to presenter video without cameras, editors, or long
                  production cycles.
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5">
                <div className="text-sm font-medium text-white">Designed to drive action</div>
                <div className="mt-2 text-sm leading-6 text-neutral-400">
                  Use presenter-led video where it matters most: homepage messaging, explainers,
                  founder trust, and sales conversion.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-white/6 px-6 py-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-neutral-500">
          {SOCIAL_PROOF.map((item) => (
            <div key={item}>{item}</div>
          ))}
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto grid max-w-6xl items-start gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <div className="text-sm uppercase tracking-[0.22em] text-neutral-500">The problem</div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
              Business video helps conversion, but producing it is still too slow and too manual.
            </h2>
          </div>

          <div className="space-y-5 text-lg leading-8 text-neutral-400">
            <p>
              Most teams know that presenter-led video improves clarity, trust, and conversion —
              but producing one polished video still takes too much time.
            </p>
            <p>
              Traditional production means cameras, voiceover, editing, revisions, and scheduling.
              Generic avatar tools improve speed, but often miss business credibility and message
              quality.
            </p>
            <p>
              iDive AI gives you a middle path: faster than traditional production and more useful
              than a basic talking-head generator.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-white/6 px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <div className="text-sm uppercase tracking-[0.22em] text-neutral-500">The solution</div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
              A focused workflow for AI business presenter videos.
            </h2>
            <p className="mt-6 text-lg leading-8 text-neutral-400">
              iDive AI helps you create business-ready presenter videos from one interface.
              Generate the presenter, shape the message, refine the script and direction in Studio,
              and render the final MP4 in minutes.
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
          <div className="grid gap-10 lg:grid-cols-[1fr_0.9fr]">
            <div>
              <div className="text-sm uppercase tracking-[0.22em] text-neutral-500">
                Why teams use it
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
                Built for the moments where business video has the highest leverage.
              </h2>
              <p className="mt-6 max-w-3xl text-lg leading-8 text-neutral-400">
                Instead of creating one-off videos with a fragmented workflow, teams can use iDive
                AI to turn repeatable business messaging into repeatable presenter-led video output.
              </p>
            </div>

            <div className="rounded-[28px] border border-neutral-800 bg-neutral-950 p-6">
              <div className="text-sm font-semibold text-white">Typical outcomes</div>
              <div className="mt-5 grid gap-3">
                {OUTCOMES.map((item) => (
                  <div
                    key={item}
                    className="rounded-2xl border border-white/8 bg-black/30 px-4 py-3 text-sm text-neutral-300"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-white/6 px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <div className="text-sm uppercase tracking-[0.22em] text-neutral-500">Use cases</div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
              Built for the business videos teams actually need to ship.
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
            <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
              From business idea to final MP4 in four steps.
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

      <section id="pricing-preview" className="border-t border-white/6 px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <div className="text-sm uppercase tracking-[0.22em] text-neutral-500">
              Pricing preview
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
              Start free. Upgrade when video becomes part of your workflow.
            </h2>
            <p className="mt-6 text-lg leading-8 text-neutral-400">
              Free is designed for trying the workflow. Pro is the best fit for most founders,
              marketers, and small teams creating videos regularly. Business is for heavier monthly
              usage and higher output volume.
            </p>
          </div>

          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            <div className="rounded-3xl border border-neutral-800 bg-neutral-950 p-6">
              <div className="text-sm font-semibold text-white">Free</div>
              <div className="mt-3 text-4xl font-semibold tracking-tight">$0</div>
              <div className="mt-1 text-sm text-neutral-500">per month</div>

              <div className="mt-6 space-y-2 text-sm text-neutral-300">
                <div>1 video / month</div>
                <div>Try the end-to-end workflow</div>
                <div>Best for first-time evaluation</div>
              </div>

              <Link
                href="/create"
                className="mt-8 inline-flex w-full items-center justify-center rounded-2xl border border-white/12 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Start free
              </Link>
            </div>

            <div className="rounded-3xl border border-white/12 bg-white/[0.06] p-6 shadow-[0_20px_80px_rgba(255,255,255,0.04)]">
              <div className="inline-flex rounded-full border border-purple-400/20 bg-purple-500/10 px-3 py-1 text-xs font-medium text-purple-200">
                Most popular
              </div>
              <div className="mt-4 text-sm font-semibold text-white">Pro</div>
              <div className="mt-3 text-4xl font-semibold tracking-tight">$29</div>
              <div className="mt-1 text-sm text-neutral-500">per month</div>

              <div className="mt-6 space-y-2 text-sm text-neutral-300">
                <div>20 videos / month</div>
                <div>Best value for regular usage</div>
                <div>Ideal for founders, marketers, and lean teams</div>
              </div>

              <Link
                href="/create"
                className="mt-8 inline-flex w-full items-center justify-center rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:opacity-95"
              >
                Start with Pro
              </Link>
            </div>

            <div className="rounded-3xl border border-purple-400/20 bg-purple-500/10 p-6">
              <div className="text-sm font-semibold text-purple-100">Business</div>
              <div className="mt-3 text-4xl font-semibold tracking-tight">$79</div>
              <div className="mt-1 text-sm text-neutral-300">per month</div>

              <div className="mt-6 space-y-2 text-sm text-neutral-200">
                <div>60 videos / month</div>
                <div>Higher monthly output capacity</div>
                <div>Best for teams with heavier usage</div>
              </div>

              <Link
                href="/create"
                className="mt-8 inline-flex w-full items-center justify-center rounded-2xl border border-purple-400/25 bg-purple-500/20 px-4 py-3 text-sm font-semibold text-white transition hover:bg-purple-500/25"
              >
                Choose Business
              </Link>
            </div>
          </div>

          <div className="mt-6 text-sm text-neutral-500">
            Start on free, validate the workflow, then upgrade when you need more monthly output.
          </div>
        </div>
      </section>

      <section className="border-t border-white/6 px-6 py-20">
        <div className="mx-auto max-w-5xl rounded-[32px] border border-neutral-800 bg-neutral-950 px-8 py-12 text-center md:px-12 md:py-16">
          <div className="text-sm uppercase tracking-[0.22em] text-neutral-500">Final CTA</div>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-5xl">
            Create your first AI business presenter video.
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-neutral-400">
            Generate a presenter, refine the message in Studio, and export a final video ready for
            your website, product, outreach, or campaigns.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/create"
              className="inline-flex rounded-2xl bg-white px-8 py-4 text-lg font-semibold text-black transition hover:opacity-95"
            >
              Create your AI presenter
            </Link>

            <a
              href="#pricing-preview"
              className="inline-flex rounded-2xl border border-white/12 bg-white/5 px-8 py-4 text-lg font-semibold text-white transition hover:bg-white/10"
            >
              Compare plans
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}