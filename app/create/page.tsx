"use client";
import { useState, useEffect } from "react";

export default function Create() {

  const [loading, setLoading] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const steps = [
    "Analyzing your request...",
    "Designing presenter appearance...",
    "Generating natural voice...",
    "Building personality...",
    "Finalizing your AI presenter..."
  ];

  // SMART TIMELINE (no bugs, no loops)
  useEffect(() => {
    if (!loading) return;

    setStepIndex(0);

    const timeouts = steps.map((_, i) =>
      setTimeout(() => {
        setStepIndex(i);
      }, i * 1200)
    );

    const finishTimeout = setTimeout(() => {
      setLoading(false);
      setCompleted(true);
    }, steps.length * 1200 + 500);

    return () => {
      timeouts.forEach(clearTimeout);
      clearTimeout(finishTimeout);
    };

  }, [loading]);

  return (
    <>
      {/* LOADER */}
      {loading && (
        <div className="fixed inset-0 bg-black flex items-center justify-center z-50">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-white mx-auto mb-6"></div>

            <p className="text-xl font-semibold animate-pulse">
              {steps[stepIndex]}
            </p>
          </div>
        </div>
      )}

      {/* RESULT — ULTRA REALISTIC AI PRESENTER */}
      {completed && (
        <div className="fixed inset-0 bg-black flex items-center justify-center z-50">
          
          <div className="bg-neutral-900 rounded-3xl overflow-hidden shadow-2xl max-w-sm border border-neutral-800">
            
            <img
              src="https://images.unsplash.com/photo-1580489944761-15a19d654956"
              className="w-full h-80 object-cover"
            />

            <div className="p-6 text-center">
              
              <h2 className="text-2xl font-bold">
                Sophia Carter
              </h2>

              <p className="text-neutral-400 mb-4">
                Senior Business Presenter
              </p>

              <p className="text-sm text-neutral-500 mb-6">
                Confident communicator specialized in delivering clear, persuasive presentations for modern brands.
              </p>

              <button
                onClick={() => setCompleted(false)}
                className="w-full py-3 bg-white text-black rounded-xl font-semibold hover:scale-105 transition"
              >
                Enter Studio
              </button>

            </div>
          </div>

        </div>
      )}

      <main className="min-h-screen bg-black text-white flex items-center justify-center px-6">
        <div className="max-w-3xl w-full">

          <h1 className="text-5xl font-bold mb-6">
            Create Your AI Presenter
          </h1>

          <p className="text-neutral-400 mb-12">
            Follow the steps below to generate a professional digital identity in seconds.
          </p>

          {/* STEP 1 */}
          <div className="mb-10">
            <h2 className="text-xl font-semibold mb-3">
              Step 1 — Choose appearance
            </h2>

            <div className="grid grid-cols-3 gap-4">
              <img src="https://images.unsplash.com/photo-1607746882042-944635dfe10e" className="rounded-xl hover:scale-105 transition cursor-pointer"/>
              <img src="https://images.unsplash.com/photo-1544005313-94ddf0286df2" className="rounded-xl hover:scale-105 transition cursor-pointer"/>
              <img src="https://images.unsplash.com/photo-1552058544-f2b08422138a" className="rounded-xl hover:scale-105 transition cursor-pointer"/>
            </div>
          </div>

          {/* STEP 2 */}
          <div className="mb-10">
            <h2 className="text-xl font-semibold mb-3">
              Step 2 — Pick a voice
            </h2>

            <div className="flex gap-4">
              <button className="px-4 py-2 bg-neutral-900 rounded-xl hover:bg-neutral-800">Professional</button>
              <button className="px-4 py-2 bg-neutral-900 rounded-xl hover:bg-neutral-800">Energetic</button>
              <button className="px-4 py-2 bg-neutral-900 rounded-xl hover:bg-neutral-800">Calm</button>
            </div>
          </div>

          {/* STEP 3 */}
          <div className="mb-12">
            <h2 className="text-xl font-semibold mb-3">
              Step 3 — What will your presenter talk about?
            </h2>

            <textarea
              className="w-full h-28 bg-neutral-900 rounded-xl p-4 outline-none focus:ring-2 focus:ring-white"
              placeholder="Example: A fitness expert helping busy professionals stay in shape..."
            />
          </div>

          <button
            onClick={() => {
              setCompleted(false);
              setLoading(true);
            }}
            className="w-full py-4 bg-white text-black rounded-2xl font-semibold text-lg hover:scale-[1.02] transition"
          >
            Generate Presenter
          </button>

        </div>
      </main>
    </>
  );
}
