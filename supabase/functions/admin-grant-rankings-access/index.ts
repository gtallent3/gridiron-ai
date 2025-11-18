import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";

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

    // Check if user is admin
    const { data: isAdmin } = await supabaseClient.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });

    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Admin access required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 }
      );
    }

    const { userId, durationDays } = await req.json();

    if (!userId) {
      throw new Error("Missing userId parameter");
    }
    
    if (durationDays === undefined || durationDays === null) {
      throw new Error("Missing durationDays parameter");
    }

    if (typeof durationDays !== 'number' || durationDays <= 0) {
      throw new Error("durationDays must be a positive number");
    }

    // Set the unlock timestamp to now and calculate expiry
    const unlockTimestamp = new Date();
    const expiryDate = new Date(unlockTimestamp.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // Update user_tokens with rankings access
    const { error: updateError } = await supabaseClient
      .from("user_tokens")
      .update({
        rankings_unlocked_at: unlockTimestamp.toISOString(),
        rankings_expires_at: expiryDate.toISOString(),
      })
      .eq("user_id", userId);

    if (updateError) throw updateError;

    const { data: userTokens } = await supabaseClient
      .from("user_tokens")
      .select("balance")
      .eq("user_id", userId)
      .single();

    await supabaseClient.from("token_transactions").insert({
      user_id: userId,
      transaction_type: "admin_grant",
      amount: 0,
      balance_after: userTokens?.balance || 0,
      description: `Admin granted ${durationDays} days of rankings access`,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: `Rankings access granted until ${expiryDate.toISOString()}`,
        expiresAt: expiryDate.toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in admin-grant-rankings-access:", error);
    const errorMessage = error instanceof Error ? error.message : "An error occurred";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
