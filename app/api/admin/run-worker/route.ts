// app/api/admin/run-worker/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(status: number, error: string, details?: any) {
  return NextResponse.json({ ok: false, error, ...(details ? { details } : {}) }, { status });
}

function makeSupabaseFromRequest(req: NextRequest, res: NextResponse) {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

  if (!url || !anon) return null;

  return createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: any) {
        res.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: any) {
        res.cookies.set({ name, value: "", ...options, maxAge: 0 });
      },
    },
  });
}

export async function POST(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = makeSupabaseFromRequest(req, res);

  if (!supabase) return jsonError(500, "missing_supabase_env_for_auth");

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return jsonError(401, "not_authenticated");

  const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const userEmail = (data.user.email || "").trim().toLowerCase();

  if (!adminEmail || userEmail !== adminEmail) return jsonError(403, "not_admin");

  const secret = (process.env.VIDEO_WORKER_SECRET || "").trim();
  if (!secret) return jsonError(500, "worker_secret_missing");

  const origin = new URL(req.url).origin;
  const workerUrl = `${origin}/api/video-worker`;

  const workerRes = await fetch(workerUrl, {
    method: "POST",
    headers: {
      "x-video-worker-secret": secret,
      "content-type": "application/json",
    },
    // important in Next route handlers
    cache: "no-store",
  });

  const body = await workerRes.json().catch(() => ({}));

  return NextResponse.json(
    {
      ok: true,
      called: workerUrl,
      workerStatus: workerRes.status,
      workerResponse: body,
    },
    { status: workerRes.ok ? 200 : 500 }
  );
}