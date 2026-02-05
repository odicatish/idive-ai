export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center">
      
      <div className="absolute inset-0 bg-gradient-to-b from-neutral-900 via-black to-black" />

      <div className="relative text-center max-w-5xl px-6">
        
        <h1 className="text-7xl font-bold tracking-tight mb-6">
          Create a Digital Identity
          <span className="block text-neutral-500">
            that feels human
          </span>
        </h1>

        <p className="text-xl text-neutral-300 mb-12 max-w-2xl mx-auto">
          AI presenters, characters, and personalities — generated in seconds, built to look real.
        </p>

        <button className="px-10 py-5 bg-white text-black rounded-2xl text-lg font-semibold hover:scale-105 transition-all duration-300 shadow-2xl">
          Create Yours Now
        </button>

      </div>
    </main>
  );
}
