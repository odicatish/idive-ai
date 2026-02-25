import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

function jsonError(status: number, error: string, details?: any) {
  return NextResponse.json({ error, ...(details ? { details } : {}) }, { status });
}

function getOrigin(req: Request) {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

export async function POST(req: Request) {
  try {
    // ✅ Allow only on non-production Vercel env (preview/dev) OR explicit override
    const vercelEnv = process.env.VERCEL_ENV; // "production" | "preview" | "development" | undefined
    const allowOverride = process.env.ALLOW_DEV_WORKER_ENDPOINT === "true";
    const isProd = vercelEnv === "production";

    if (isProd && !allowOverride) {
      return jsonError(403, "forbidden", "Dev worker endpoint disabled in production.");
    }

    // ✅ Require logged-in user (uses cookies)
    const supabase = await supabaseServer();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return jsonError(401, "unauthorized");

    // ✅ Call the real worker endpoint server-to-server (secret stays server-side)
    const secret = process.env.VIDEO_WORKER_SECRET || "dev_secret_123";
    const origin = getOrigin(req);

    const res = await fetch(`${origin}/api/video-worker`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      cache: "no-store",
    });

    const contentType = res.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await res.json() : await res.text();

    if (!res.ok) {
      return jsonError(res.status, "worker_call_failed", payload);
    }

    return NextResponse.json({ ok: true, worker: payload });
  } catch (e: any) {
    console.error("RUN_VIDEO_WORKER_ERROR", e);
    return jsonError(500, "internal_error", e?.message ?? String(e));
  }
}