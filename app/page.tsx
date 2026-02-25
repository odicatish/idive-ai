import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-6">
      <div className="text-center max-w-3xl w-full">
        <h1 className="text-6xl font-bold tracking-tight mb-4">
          Create a Digital Identity
        </h1>

        <p className="text-5xl font-bold tracking-tight text-white/40 mb-6">
          that feels human
        </p>

        <p className="text-neutral-400 mb-12 text-lg">
          AI presenters, characters, and personalities — generated in seconds, built to look real.
        </p>

        <Link href="/create">
          <button className="px-10 py-4 bg-white text-black rounded-2xl text-lg font-semibold hover:scale-105 transition">
            Create Yours Now
          </button>
        </Link>
      </div>
    </main>
  );
}
