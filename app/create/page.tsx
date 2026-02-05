"use client";
import { useState, useEffect } from "react";

export default function Create() {

  const [loading, setLoading] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [studio, setStudio] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const steps = [
    "Analyzing your request...",
    "Designing presenter appearance...",
    "Generating natural voice...",
    "Building personality...",
    "Finalizing your AI presenter..."
  ];

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

      {/* RESULT */}
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
                onClick={() => {
                  setCompleted(false);
                  setStudio(true);
                }}
                className="w-full py-3 bg-white text-black rounded-xl font-semibold hover:scale-105 transition"
              >
                Enter Studio
              </button>

            </div>
          </div>

        </div>
      )}

      {/* 🎬 STUDIO */}
      {studio && (
        <div className="min-h-screen bg-black text-white flex">

          {/* LEFT */}
          <div className="w-1/2 flex flex-col items-center justify-center border-r border-neutral-800">
            
            <img
              src="https://images.unsplash.com/photo-1580489944761-15a19d654956"
              className="h-[420px] w-[320px] object-cover rounded-3xl shadow-2xl mb-6"
            />

            <h2 className="text-3xl font-bold">
              Sophia Carter
            </h2>

            <p className="text-neutral-400 mb-3">
              Senior Business Presenter
            </p>

            <div className="flex gap-3">
              <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-sm">
                ● Online
              </span>

              <span className="px-3 py-1 bg-indigo-500/20 text-indigo-400 rounded-full text-sm">
                AI Ready
              </span>
            </div>

          </div>

          {/* RIGHT */}
          <div className="w-1/2 flex flex-col justify-center px-20 gap-6">

            <button className="w-full py-5 bg-white text-black rounded-2xl text-lg font-semibold hover:scale-[1.02] transition">
              🎬 Create Video
            </button>

            <button className="w-full py-5 bg-neutral-900 rounded-2xl text-lg font-semibold hover:bg-neutral-800 transition">
              🎤 Clone Voice
            </button>

            <button className="w-full py-5 bg-neutral-900 rounded-2xl text-lg font-semibold hover:bg-neutral-800 transition">
              ✍️ Generate Script
            </button>

          </div>

        </div>
      )}

      {/* CREATE SCREEN */}
      {!studio && !loading && !completed && (
        <main className="min-h-screen bg-black text-white flex items-center justify-center px-6">
          <div className="max-w-3xl w-full">

            <h1 className="text-5xl font-bold mb-6">
              Create Your AI Presenter
            </h1>

            <p className="text-neutral-400 mb-12">
              Follow the steps below to generate a professional digital identity in seconds.
            </p>

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
      )}

    </>
  );
}
