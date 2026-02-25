// app/api/export/create/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set() {},
        remove() {},
      },
    }
  );

  // 1) auth
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth?.user) {
    return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
  }

  const userId = auth.user.id;

  // 2) pro gate
  const { data: sub, error: subError } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subError) {
    return NextResponse.json({ error: subError.message }, { status: 500 });
  }

  const isPro = sub?.status === "active" || sub?.status === "trialing";
  if (!isPro) {
    return NextResponse.json({ error: "PRO_REQUIRED" }, { status: 403 });
  }

  // 3) body
  const body = await req.json().catch(() => null);
  const presenter = body?.presenter ?? null;
  const prompt = typeof body?.prompt === "string" ? body.prompt : null;

  if (!presenter) {
    return NextResponse.json({ error: "Missing presenter" }, { status: 400 });
  }

  // 4) create job
  const { data: job, error: jobError } = await supabase
    .from("exports")
    .insert({
      user_id: userId,
      status: "queued",
      progress: 0,
      presenter,
      prompt,
    })
    .select("id")
    .single();

  if (jobError) {
    return NextResponse.json({ error: jobError.message }, { status: 500 });
  }

  return NextResponse.json({ jobId: job.id }, { status: 200 });
}
