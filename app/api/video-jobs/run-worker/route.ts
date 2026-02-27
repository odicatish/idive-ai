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

export async function POST(req: Request) {
  try {
    const supabase = await getSupabase();

    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth?.user) {
      return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
    }

    const secret = process.env.VIDEO_WORKER_SECRET;
    if (!secret) {
      return NextResponse.json({ error: "Missing VIDEO_WORKER_SECRET" }, { status: 500 });
    }

    // rulează același deploy, dar server-side (nu expui secret)
    const url = new URL(req.url);
    const origin = `${url.protocol}//${url.host}`;

    const r = await fetch(`${origin}/api/video-worker?secret=${encodeURIComponent(secret)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const txt = await r.text().catch(() => "");
    return NextResponse.json(
      { ok: r.ok, status: r.status, body: txt ? safeJson(txt) : null },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown_error" }, { status: 500 });
  }
}

function safeJson(txt: string) {
  try {
    return JSON.parse(txt);
  } catch {
    return txt;
  }
}