"use client";
import { useState, useEffect } from "react";

export default function Create() {

  const [loading, setLoading] = useState(false);
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

    const interval = setInterval(() => {
      setStepIndex((prev) => {
        if (prev === steps.length - 1) {
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, 1200);

    return () => clearInterval(interval);
  }, [loading]);

  return (
    <>
      {loading && (
        <div className="fixed inset-0 bg-black flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-white mx-auto mb-6"></div>

            <p className="text-xl font-semibold">
              {steps[stepIndex]}
            </p>

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

          <div className="mb-10">
            <h2 className="text-xl font-semibold mb-3">
              Step 1 — Choose appearance
            </h2>

            <div className="grid grid-cols-3 gap-4">
              <img
                src="https://images.unsplash.com/photo-1607746882042-944635dfe10e"
                className="rounded-xl cursor-pointer hover:scale-105 transition"
              />

              <img
                src="https://images.unsplash.com/photo-1544005313-94ddf0286df2"
                className="rounded-xl cursor-pointer hover:scale-105 transition"
              />

              <img
                src="https://images.unsplash.com/photo-1552058544-f2b08422138a"
                className="rounded-xl cursor-pointer hover:scale-105 transition"
              />
            </div>
          </div>

          <div className="mb-10">
            <h2 className="text-xl font-semibold mb-3">
              Step 2 — Pick a voice
            </h2>

            <div className="flex gap-4">
              <button className="px-4 py-2 bg-neutral-900 rounded-xl hover:bg-neutral-800">
                Professional
              </button>

              <button className="px-4 py-2 bg-neutral-900 rounded-xl hover:bg-neutral-800">
                Energetic
              </button>
