import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "../_shared/imports.ts";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CHECK-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");
    
    const authHeader = req.headers.get('Authorization');
    logStep("Authorization header", { header: authHeader?.substring(0, 20) + '...' });
    
    if (!authHeader) {
      throw new Error("No Authorization header provided");
    }

    // Extract the JWT token from the Authorization header
    const jwt = authHeader.replace('Bearer ', '');
    
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { 
        global: { 
          headers: { Authorization: authHeader } 
        },
        auth: { persistSession: false }
      }
    );

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    // Get user with explicit JWT token
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(jwt);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { userId: user.id });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    
    if (customers.data.length === 0) {
      logStep("No customer found");
      return new Response(JSON.stringify({ subscribed: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const customerId = customers.data[0].id;
    logStep("Found customer", { customerId });

    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10,
    });

    const activeSub = subscriptions.data.find((s: any) => {
      const statusOk = s.status === 'active' || s.status === 'trialing';
      const endOk = typeof s.current_period_end === 'number' && (s.current_period_end * 1000) > Date.now();
      return statusOk && endOk;
    });
    
    if (!activeSub) {
      logStep("No active subscription");
      return new Response(JSON.stringify({ subscribed: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const productId = activeSub.items?.data?.[0]?.price?.product as string | undefined;
    const subscriptionEnd = (typeof activeSub.current_period_end === 'number' && !isNaN(activeSub.current_period_end))
      ? new Date(activeSub.current_period_end * 1000).toISOString()
      : null;
    const cancelAtPeriodEnd = !!activeSub.cancel_at_period_end;
    const trialEnd = (typeof activeSub.trial_end === 'number' && !isNaN(activeSub.trial_end))
      ? new Date(activeSub.trial_end * 1000).toISOString()
      : null;
    
    logStep("Active subscription found", {
      subscriptionId: activeSub.id,
      productId,
      status: activeSub.status,
      cancelAtPeriodEnd,
      subscriptionEnd,
      trialEnd,
    });

    return new Response(
      JSON.stringify({
        subscribed: true,
        product_id: productId ?? null,
        subscription_end: subscriptionEnd,
        status: activeSub.status,
        cancel_at_period_end: cancelAtPeriodEnd,
        trial_end: trialEnd,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});