import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) throw new Error("Unauthorized");

    const { currentWeek } = await req.json();
    if (!currentWeek) throw new Error("Current week is required");

    // Check user's token balance and subscription status
    const { data: userTokens, error: tokensError } = await supabaseClient
      .from("user_tokens")
      .select("balance, has_unlimited_subscription, subscription_expires_at, rankings_unlocked_at, lifetime_spent")
      .eq("user_id", user.id)
      .single();

    if (tokensError) throw tokensError;

    // Check if user is an active subscriber
    const isActiveSubscriber =
      userTokens.has_unlimited_subscription &&
      userTokens.subscription_expires_at &&
      new Date(userTokens.subscription_expires_at) > new Date();

    // If subscriber, just update timestamp (always have access)
    if (isActiveSubscriber) {
      const { error: updateError } = await supabaseClient
        .from("user_tokens")
        .update({ 
          rankings_unlocked_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);

      if (updateError) throw updateError;

      return new Response(
        JSON.stringify({
          success: true,
          unlimited: true,
          message: "Rankings unlocked (subscriber access)",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if already unlocked (within 7 days)
    if (userTokens.rankings_unlocked_at) {
      const unlockedAt = new Date(userTokens.rankings_unlocked_at);
      const sevenDaysLater = new Date(unlockedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      
      if (new Date() < sevenDaysLater) {
        return new Response(
          JSON.stringify({
            success: true,
            message: "Rankings already unlocked",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Non-subscriber: check token balance
    if (userTokens.balance < 1) {
      return new Response(
        JSON.stringify({
          success: false,
          insufficient: true,
          error: "Insufficient tokens",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Deduct 1 token and unlock
    const newBalance = userTokens.balance - 1;
    const currentLifetimeSpent = userTokens.lifetime_spent || 0;
    const unlockTimestamp = new Date().toISOString();
    
    const { error: updateError } = await supabaseClient
      .from("user_tokens")
      .update({
        balance: newBalance,
        lifetime_spent: currentLifetimeSpent + 1,
        rankings_unlocked_at: unlockTimestamp,
      })
      .eq("user_id", user.id);

    if (updateError) throw updateError;

    // Log the transaction
    await supabaseClient.from("token_transactions").insert({
      user_id: user.id,
      transaction_type: "ranking_unlock",
      amount: -1,
      balance_after: newBalance,
      description: "Unlocked positional rankings for 7 days",
    });

    return new Response(
      JSON.stringify({
        success: true,
        balance: newBalance,
        message: "Rankings unlocked for 7 days",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in unlock-rankings:", error);
    const errorMessage = error instanceof Error ? error.message : "An error occurred";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
