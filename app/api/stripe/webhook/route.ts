// app/api/stripe/webhook/route.ts
import Stripe from "stripe";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UpsertParams = {
  userId: string;
  customerId: string | null;
  subscription: Stripe.Subscription;
};

function getEnv(name: string) {
  const v = process.env[name];
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(req: Request) {
  const stripeSecretKey = getEnv("STRIPE_SECRET_KEY");
  const webhookSecret = getEnv("STRIPE_WEBHOOK_SECRET");

  const supabaseUrl = getEnv("SUPABASE_URL") || getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseServiceRole = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!stripeSecretKey) return NextResponse.json({ error: "Missing STRIPE_SECRET_KEY" }, { status: 500 });
  if (!webhookSecret) return NextResponse.json({ error: "Missing STRIPE_WEBHOOK_SECRET" }, { status: 500 });
  if (!supabaseUrl) return NextResponse.json({ error: "Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL" }, { status: 500 });
  if (!supabaseServiceRole) return NextResponse.json({ error: "Missing SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });

  // ✅ NU setăm apiVersion ca să nu mai dea TS mismatch
  const stripe = new Stripe(stripeSecretKey);

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRole);

  async function upsertSubscription({ userId, customerId, subscription }: UpsertParams) {
    const priceId = subscription.items.data[0]?.price?.id ?? null;
    const periodEnd = (subscription as any).current_period_end as number | undefined;
    const currentPeriodEnd = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;

    const { error } = await supabaseAdmin
      .from("subscriptions")
      .upsert(
        {
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscription.id,
          status: subscription.status,
          current_period_end: currentPeriodEnd,
          price_id: priceId,
        },
        { onConflict: "stripe_subscription_id" }
      );

    if (error) throw error;
  }

  const h = await headers();
  const sig = h.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${err?.message ?? "unknown"}` },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        const userId = session.metadata?.user_id;
        if (!userId) throw new Error("Missing session.metadata.user_id");

        const customerId =
          typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null;

        if (!subscriptionId) break;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await upsertSubscription({ userId, customerId, subscription });
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

        const { data, error } = await supabaseAdmin
          .from("subscriptions")
          .select("user_id")
          .eq("stripe_customer_id", customerId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;

        const metaUserId = (sub.metadata as any)?.user_id as string | undefined;
        const userId = data?.user_id ?? metaUserId;
        if (!userId) break;

        await upsertSubscription({ userId, customerId, subscription: sub });
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Webhook handler failed" }, { status: 500 });
  }
}