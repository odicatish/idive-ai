// app/api/stripe/checkout/route.ts
import Stripe from "stripe";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlanKey = "pro" | "business";

function getEnv(name: string) {
  const v = process.env[name];
  return typeof v === "string" ? v.trim() : "";
}

function getPriceIdForPlan(plan: string): { plan: PlanKey; priceId: string } | null {
  const normalized = String(plan || "").trim().toLowerCase();

  if (normalized === "pro") {
    const priceId = getEnv("STRIPE_PRICE_ID_PRO");
    if (!priceId) {
      throw new Error("Missing STRIPE_PRICE_ID_PRO");
    }
    return { plan: "pro", priceId };
  }

  if (normalized === "business") {
    const priceId = getEnv("STRIPE_PRICE_ID_BUSINESS");
    if (!priceId) {
      throw new Error("Missing STRIPE_PRICE_ID_BUSINESS");
    }
    return { plan: "business", priceId };
  }

  return null;
}

export async function POST(req: Request) {
  const stripeSecretKey = getEnv("STRIPE_SECRET_KEY");
  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (!stripeSecretKey) {
    return NextResponse.json({ error: "Missing STRIPE_SECRET_KEY" }, { status: 500 });
  }

  if (!supabaseUrl) {
    return NextResponse.json({ error: "Missing NEXT_PUBLIC_SUPABASE_URL" }, { status: 500 });
  }

  if (!supabaseAnon) {
    return NextResponse.json({ error: "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY" }, { status: 500 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  let selectedPlan: ReturnType<typeof getPriceIdForPlan>;
  try {
    selectedPlan = getPriceIdForPlan(body?.plan);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Invalid configuration" }, { status: 500 });
  }

  if (!selectedPlan) {
    return NextResponse.json(
      {
        error: "INVALID_PLAN",
        message: "Plan must be one of: pro, business",
      },
      { status: 400 }
    );
  }

  const stripe = new Stripe(stripeSecretKey);
  const cookieStore = await cookies();

  const supabase = createServerClient(supabaseUrl, supabaseAnon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set() {},
      remove() {},
    },
  });

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth?.user) {
    return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
  }

  const appUrl = (getEnv("NEXT_PUBLIC_APP_URL") || "http://localhost:3000").replace(/\/$/, "");

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: selectedPlan.priceId, quantity: 1 }],
    success_url: `${appUrl}/create?checkout=success&plan=${selectedPlan.plan}`,
    cancel_url: `${appUrl}/create?checkout=cancel&plan=${selectedPlan.plan}`,
    metadata: {
      user_id: auth.user.id,
      plan: selectedPlan.plan,
    },
  });

  return NextResponse.json({
    url: session.url,
    plan: selectedPlan.plan,
  });
}