export default function Create() {
  return (
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

        {/* STEP 2 */}
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

            <button className="px-4 py-2 bg-neutral-900 rounded-xl hover:bg-neutral-800">
              Calm
            </button>
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

        {/* CTA */}
        <button className="w-full py-4 bg-white text-black rounded-2xl font-semibold text-lg hover:scale-[1.02] transition">
          Generate Presenter
        </button>

      </div>
    </main>
  );
}
