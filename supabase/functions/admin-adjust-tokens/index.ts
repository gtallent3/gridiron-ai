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

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    // Get authenticated user
    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    
    if (!user) {
      throw new Error("Unauthorized");
    }

    // Check if user has admin role
    const { data: hasAdminRole, error: roleError } = await supabaseClient
      .rpc("has_role", { _user_id: user.id, _role: "admin" });

    if (roleError || !hasAdminRole) {
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 }
      );
    }

    const { action, amount, userId: targetUserId } = await req.json();

    // Validate target user ID
    if (!targetUserId) {
      return new Response(
        JSON.stringify({ error: "Target user ID is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUserId)) {
      return new Response(
        JSON.stringify({ error: "Invalid user ID format" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Get current balance for TARGET user
    const { data: tokenData } = await supabaseClient
      .from("user_tokens")
      .select("balance")
      .eq("user_id", targetUserId)
      .maybeSingle();

    let newBalance = tokenData?.balance || 0;

    switch (action) {
      case "add":
        newBalance += amount;
        break;
      case "subtract":
        newBalance = Math.max(0, newBalance - amount);
        break;
      case "set":
        newBalance = Math.max(0, amount);
        break;
    }

    // Update balance for TARGET user
    const { error } = await supabaseClient
      .from("user_tokens")
      .upsert({
        user_id: targetUserId,
        balance: newBalance,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (error) throw error;

    // Log transaction for TARGET user
    await supabaseClient.from("token_transactions").insert({
      user_id: targetUserId,
      transaction_type: "admin_adjustment",
      amount: action === "subtract" ? -amount : amount,
      balance_after: newBalance,
      description: `Admin adjustment by ${user.email || user.id.substring(0, 8)}: ${action} ${amount} tokens`,
    });

    return new Response(
      JSON.stringify({ success: true, newBalance }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
