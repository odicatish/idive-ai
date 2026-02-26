// app/api/stripe/checkout/route.ts
import Stripe from "stripe";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getEnv(name: string) {
  const v = process.env[name];
  return typeof v === "string" ? v.trim() : "";
}

export async function POST() {
  const stripeSecretKey = getEnv("STRIPE_SECRET_KEY");
  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const priceId = getEnv("STRIPE_PRICE_ID");

  if (!stripeSecretKey) return NextResponse.json({ error: "Missing STRIPE_SECRET_KEY" }, { status: 500 });
  if (!supabaseUrl) return NextResponse.json({ error: "Missing NEXT_PUBLIC_SUPABASE_URL" }, { status: 500 });
  if (!supabaseAnon) return NextResponse.json({ error: "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY" }, { status: 500 });
  if (!priceId) return NextResponse.json({ error: "Missing STRIPE_PRICE_ID" }, { status: 500 });

  // ✅ NU setăm apiVersion ca să nu mai dea TS mismatch
  const stripe = new Stripe(stripeSecretKey);

  // ✅ cookies() poate fi Promise -> await
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
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/create?checkout=success`,
    cancel_url: `${appUrl}/create?checkout=cancel`,
    metadata: { user_id: auth.user.id },
  });

  return NextResponse.json({ url: session.url });
}