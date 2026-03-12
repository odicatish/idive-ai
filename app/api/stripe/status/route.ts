import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLAN_LIMITS = {
  free: 1,
  pro: 20,
  business: 60
};

export async function GET() {

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
        remove() {}
      }
    }
  );

  const { data: auth, error: authError } = await supabase.auth.getUser();

  if (authError || !auth?.user) {
    return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
  }

  const { data } = await supabase
    .from("subscriptions")
    .select("status, price_id")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let plan: "free" | "pro" | "business" = "free";

  if (data?.status === "active" || data?.status === "trialing") {

    if (data.price_id === process.env.STRIPE_PRICE_ID_PRO) {
      plan = "pro";
    }

    if (data.price_id === process.env.STRIPE_PRICE_ID_BUSINESS) {
      plan = "business";
    }

  }

  return NextResponse.json({
    plan,
    video_limit: PLAN_LIMITS[plan],
    active: plan !== "free"
  });

}