import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user's token record
    const { data: userTokens, error: fetchError } = await supabase
      .from("user_tokens")
      .select("last_weekly_reward_at, balance")
      .eq("user_id", user.id)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    // Check if user already claimed reward this week
    const now = new Date();
    const lastReward = userTokens.last_weekly_reward_at ? new Date(userTokens.last_weekly_reward_at) : null;
    
    if (lastReward) {
      const daysSinceLastReward = (now.getTime() - lastReward.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastReward < 7) {
        const nextRewardDate = new Date(lastReward);
        nextRewardDate.setDate(nextRewardDate.getDate() + 7);
        
        return new Response(
          JSON.stringify({
            success: false,
            message: "Weekly reward already claimed",
            nextRewardDate: nextRewardDate.toISOString(),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Grant weekly reward
    const rewardAmount = 1;
    const newBalance = userTokens.balance + rewardAmount;

    const { error: updateError } = await supabase
      .from("user_tokens")
      .update({
        balance: newBalance,
        last_weekly_reward_at: now.toISOString(),
        lifetime_earned: supabase.rpc('increment', { x: rewardAmount }),
      })
      .eq("user_id", user.id);

    if (updateError) throw updateError;

    // Log transaction
    const { error: logError } = await supabase
      .from("token_transactions")
      .insert({
        user_id: user.id,
        transaction_type: "weekly_reward",
        amount: rewardAmount,
        balance_after: newBalance,
        description: "Weekly engagement bonus",
      });

    if (logError) console.error("Failed to log transaction:", logError);

    return new Response(
      JSON.stringify({
        success: true,
        rewardAmount,
        newBalance,
        message: "Weekly reward claimed successfully!",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error granting weekly reward:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
