// app/api/video-jobs/run-worker/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSupabase() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set() {},
      remove() {},
    },
  });
}

function safeJson(txt: string) {
  try {
    return JSON.parse(txt);
  } catch {
    return txt;
  }
}

function getOrigin(req: Request) {
  // Vercel/Next: prefer forwarded headers
  const proto =
    req.headers.get("x-forwarded-proto") ||
    new URL(req.url).protocol.replace(":", "");

  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    new URL(req.url).host;

  return `${proto}://${host}`;
}

async function runWorker(req: Request) {
  const supabase = await getSupabase();

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth?.user) {
    return NextResponse.json({ ok: false, error: "NOT_AUTHENTICATED" }, { status: 401 });
  }

  const secret = (process.env.VIDEO_WORKER_SECRET || "").trim();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Missing VIDEO_WORKER_SECRET" },
      { status: 500 }
    );
  }

  // rulează worker-ul pe același origin (server-side), fără să expui secretul în client
  const origin = getOrigin(req);

  const r = await fetch(`${origin}/api/video-worker?secret=${encodeURIComponent(secret)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });

  const txt = await r.text().catch(() => "");
  return NextResponse.json(
    { ok: r.ok, status: r.status, body: txt ? safeJson(txt) : null },
    { status: 200 }
  );
}

// ✅ Acceptăm și GET (pt test în browser / dacă UI cheamă greșit)
export async function GET(req: Request) {
  try {
    return await runWorker(req);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    return await runWorker(req);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown_error" }, { status: 500 });
  }
}