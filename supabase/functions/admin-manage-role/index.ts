import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
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
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Authenticate the requesting user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error("Invalid authentication");
    }

    // Check if requesting user is admin
    const { data: adminCheck } = await supabaseClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .single();

    if (!adminCheck) {
      throw new Error("Unauthorized: Admin access required");
    }

    const { targetUserId, action } = await req.json();

    if (!targetUserId || !action) {
      throw new Error("Missing required fields: targetUserId and action");
    }

    if (action === "grant") {
      // Grant admin role
      const { error: insertError } = await supabaseClient
        .from("user_roles")
        .insert({
          user_id: targetUserId,
          role: "admin"
        });

      if (insertError) {
        // Check if role already exists
        if (insertError.code === "23505") {
          return new Response(
            JSON.stringify({ message: "User already has admin role" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
          );
        }
        throw insertError;
      }

      return new Response(
        JSON.stringify({ message: "Admin role granted successfully" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );

    } else if (action === "revoke") {
      // Prevent self-revocation
      if (targetUserId === user.id) {
        throw new Error("Cannot revoke your own admin privileges");
      }

      // Revoke admin role
      const { error: deleteError } = await supabaseClient
        .from("user_roles")
        .delete()
        .eq("user_id", targetUserId)
        .eq("role", "admin");

      if (deleteError) throw deleteError;

      return new Response(
        JSON.stringify({ message: "Admin role revoked successfully" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );

    } else {
      throw new Error("Invalid action. Must be 'grant' or 'revoke'");
    }

  } catch (error: any) {
    console.error("Error in admin-manage-role:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});