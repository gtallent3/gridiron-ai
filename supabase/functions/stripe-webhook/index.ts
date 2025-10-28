/**
 * Stripe Webhook Handler for Gridiron-GM Token System
 * 
 * This function handles Stripe webhook events to automatically credit tokens
 * after successful payments and manage subscription renewals.
 * 
 * IMPORTANT SETUP STEPS:
 * 1. Deploy this function (happens automatically when you save)
 * 2. Go to Stripe Dashboard > Developers > Webhooks
 * 3. Click "Add endpoint"
 * 4. Use this URL: https://zeklwogchobqttevcckl.supabase.co/functions/v1/stripe-webhook
 * 5. Select these events:
 *    - checkout.session.completed
 *    - invoice.payment_succeeded
 *    - customer.subscription.deleted
 * 6. Save and copy the "Signing secret" (already configured)
 * 
 * Events Handled:
 * - checkout.session.completed: Credits tokens for one-time purchases and subscription signups
 * - invoice.payment_succeeded: Credits monthly tokens on subscription renewal
 * - customer.subscription.deleted: Disables unlimited subscription on cancellation
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[STRIPE-WEBHOOK] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    logStep("Webhook received");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const signature = req.headers.get("stripe-signature");
    const body = await req.text();

    if (!signature) {
      throw new Error("No Stripe signature found");
    }

    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!webhookSecret) {
      throw new Error("STRIPE_WEBHOOK_SECRET is not set");
    }

    // Verify webhook signature for security
    let event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
      logStep("Webhook signature verified");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logStep("Webhook signature verification failed", { error: errorMessage });
      throw new Error(`Webhook signature verification failed: ${errorMessage}`);
    }
    logStep("Event type", { type: event.type });

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        logStep("Checkout completed", { sessionId: session.id });

        const userId = session.metadata?.user_id;
        const packageType = session.metadata?.package_type;
        const tokens = parseInt(session.metadata?.tokens || "0");
        const packageName = session.metadata?.package_name || "";
        const customerId = session.customer as string;

        if (!userId) {
          throw new Error("No user_id in session metadata");
        }

        // Store payment method fingerprint if available
        if (session.payment_intent) {
          try {
            const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent as string);
            if (paymentIntent.charges?.data?.[0]?.payment_method_details?.card?.fingerprint) {
              const cardFingerprint = paymentIntent.charges.data[0].payment_method_details.card.fingerprint;
              
              await supabaseClient
                .from("payment_fingerprints")
                .upsert({
                  user_id: userId,
                  fingerprint: cardFingerprint,
                  stripe_payment_method_id: paymentIntent.payment_method as string,
                  last_used: new Date().toISOString(),
                }, { 
                  onConflict: 'user_id,fingerprint',
                  ignoreDuplicates: false 
                });
              
              logStep("Payment fingerprint stored", { fingerprint: cardFingerprint.slice(0, 8) + '...' });
            }
          } catch (fpError) {
            logStep("Failed to store payment fingerprint", { error: fpError });
          }
        }

        // Update app_users with Stripe customer ID
        await supabaseClient
          .from("app_users")
          .update({ stripe_customer_id: customerId })
          .eq("user_id", userId);

        if (packageType === "subscription") {
          // Handle subscription signup
          logStep("Processing subscription", { userId });

          // Get subscription details
          const subscriptionId = session.subscription;
          if (!subscriptionId) {
            throw new Error("No subscription ID in session");
          }

          let periodEnd: Date;
          try {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId as string);
            if (!subscription.current_period_end) {
              throw new Error("No current_period_end on subscription");
            }
            periodEnd = new Date(subscription.current_period_end * 1000);
            logStep("Subscription retrieved", { 
              subscriptionId, 
              periodEnd: periodEnd.toISOString() 
            });
          } catch (subError) {
            // If subscription retrieval fails, set expiry to 1 month from now
            logStep("Subscription retrieval failed, using default expiry", { error: subError });
            periodEnd = new Date();
            periodEnd.setMonth(periodEnd.getMonth() + 1);
          }

          // Get current balance first
          const { data: currentTokenData } = await supabaseClient
            .from("user_tokens")
            .select("balance, lifetime_earned")
            .eq("user_id", userId)
            .maybeSingle();

          const newBalance = (currentTokenData?.balance || 0) + 10;
          const newLifetimeEarned = (currentTokenData?.lifetime_earned || 0) + 10;

          // UPSERT user tokens with unlimited subscription
          const { error: updateError } = await supabaseClient
            .from("user_tokens")
            .upsert({
              user_id: userId,
              has_unlimited_subscription: true,
              subscription_expires_at: periodEnd.toISOString(),
              balance: newBalance,
              lifetime_earned: newLifetimeEarned,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'user_id' });

          if (updateError) throw updateError;

          const tokenData = { balance: newBalance };

          await supabaseClient.from("token_transactions").insert({
            user_id: userId,
            transaction_type: "subscription",
            amount: 10,
            balance_after: tokenData?.balance || 0,
            description: "Unlimited Monthly subscription started - 10 bonus tokens",
            metadata: {
              stripe_session_id: session.id,
              stripe_subscription_id: subscriptionId,
            },
          });

          logStep("Subscription processed successfully");
        } else {
          // Handle one-time purchase
          logStep("Processing one-time purchase", { userId, tokens });

          // Get current balance first
          const { data: currentPurchaseData } = await supabaseClient
            .from("user_tokens")
            .select("balance, lifetime_purchased")
            .eq("user_id", userId)
            .maybeSingle();

          const newPurchaseBalance = (currentPurchaseData?.balance || 0) + tokens;
          const newLifetimePurchased = (currentPurchaseData?.lifetime_purchased || 0) + tokens;

          // UPSERT tokens to user balance
          const { error: updateError } = await supabaseClient
            .from("user_tokens")
            .upsert({
              user_id: userId,
              balance: newPurchaseBalance,
              lifetime_purchased: newLifetimePurchased,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'user_id' });

          if (updateError) throw updateError;

          const tokenData = { balance: newPurchaseBalance };

          await supabaseClient.from("token_transactions").insert({
            user_id: userId,
            transaction_type: "purchase",
            amount: tokens,
            balance_after: tokenData?.balance || 0,
            description: `Purchased ${packageName}`,
            metadata: {
              stripe_session_id: session.id,
              package_name: packageName,
            },
          });

          logStep("Purchase processed successfully");
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        logStep("Invoice payment succeeded", { invoiceId: invoice.id });

        // Handle subscription renewal
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
          const userId = subscription.metadata?.user_id;

          if (userId) {
            const periodEnd = new Date(subscription.current_period_end * 1000);

            // Get current balance first
            const { data: renewalData } = await supabaseClient
              .from("user_tokens")
              .select("balance, lifetime_earned, has_unlimited_subscription")
              .eq("user_id", userId)
              .maybeSingle();

            const newRenewalBalance = (renewalData?.balance || 0) + 10;
            const newRenewalEarned = (renewalData?.lifetime_earned || 0) + 10;

            // UPSERT subscription renewal and add monthly tokens
            const { error: updateError } = await supabaseClient
              .from("user_tokens")
              .upsert({
                user_id: userId,
                has_unlimited_subscription: true,
                subscription_expires_at: periodEnd.toISOString(),
                balance: newRenewalBalance,
                lifetime_earned: newRenewalEarned,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'user_id' });

            if (updateError) throw updateError;

            const tokenData = { balance: newRenewalBalance };

            await supabaseClient.from("token_transactions").insert({
              user_id: userId,
              transaction_type: "subscription",
              amount: 10,
              balance_after: tokenData?.balance || 0,
              description: "Monthly subscription renewal - 10 tokens",
              metadata: {
                stripe_invoice_id: invoice.id,
                stripe_subscription_id: subscription.id,
              },
            });

            logStep("Subscription renewed successfully");
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        logStep("Subscription deleted", { subscriptionId: subscription.id });

        const userId = subscription.metadata?.user_id;
        if (userId) {
          // Disable unlimited subscription
          const { error: updateError } = await supabaseClient
            .from("user_tokens")
            .update({
              has_unlimited_subscription: false,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", userId);

          if (updateError) throw updateError;

          logStep("Subscription cancelled successfully");
        }
        break;
      }

      default:
        logStep("Unhandled event type", { type: event.type });
    }

    return new Response(
      JSON.stringify({ received: true }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
