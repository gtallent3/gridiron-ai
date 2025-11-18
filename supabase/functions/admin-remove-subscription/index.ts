import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[ADMIN-REMOVE-SUBSCRIPTION] ${step}${detailsStr}`);
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
    logStep("Function started");

    // Authenticate the admin user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !userData.user) throw new Error("Authentication failed");
    
    const adminId = userData.user.id;
    logStep("Admin authenticated", { adminId });

    // Verify admin role
    const { data: roleData, error: roleError } = await supabaseClient.rpc('has_role', {
      _user_id: adminId,
      _role: 'admin'
    });

    if (roleError || !roleData) {
      throw new Error("Unauthorized: Admin role required");
    }

    // Parse request body
    const { userId } = await req.json();
    
    if (!userId) {
      throw new Error("userId is required");
    }

    logStep("Removing subscription", { userId });

    // Remove subscription status
    const { error: updateError } = await supabaseClient
      .from("user_tokens")
      .update({
        has_unlimited_subscription: false,
        subscription_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (updateError) throw updateError;

    // Log the action
    const { data: currentTokenData } = await supabaseClient
      .from("user_tokens")
      .select("balance")
      .eq("user_id", userId)
      .single();

    await supabaseClient.from("token_transactions").insert({
      user_id: userId,
      transaction_type: "admin_grant",
      amount: 0,
      balance_after: currentTokenData?.balance || 0,
      description: "Admin removed subscription status",
      metadata: {
        removed_by: adminId,
      },
    });

    logStep("Subscription removed successfully");

    return new Response(
      JSON.stringify({ success: true }),
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
