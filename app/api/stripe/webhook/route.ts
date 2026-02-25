import Stripe from "stripe";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!, // sau SUPABASE_URL dacă îl ai
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function upsertSubscription(params: {
  userId: string;
  customerId: string | null;
  subscription: Stripe.Subscription;
}) {
  const { userId, customerId, subscription } = params;

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

export async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return NextResponse.json({ error: "Missing STRIPE_WEBHOOK_SECRET" }, { status: 500 });
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
      { error: `Webhook signature verification failed: ${err.message}` },
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

        // caută user_id din DB via customer id
        const { data, error } = await supabaseAdmin
          .from("subscriptions")
          .select("user_id")
          .eq("stripe_customer_id", customerId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;

        // fallback: dacă pui user_id în metadata pe subscription
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
