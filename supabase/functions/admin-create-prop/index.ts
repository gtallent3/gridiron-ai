import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const propSchema = z.object({
  player_name: z.string().trim().min(1).max(100),
  team: z.string().trim().length(3).regex(/^[A-Z]{3}$/),
  stat_type: z.enum(['passing_yards', 'rushing_yards', 'receiving_yards', 'touchdowns', 'receptions', 'passing_touchdowns', 'rushing_touchdowns', 'receiving_touchdowns']),
  line: z.number().positive().max(1000),
  over_multiplier: z.number().min(1.0).max(10.0),
  under_multiplier: z.number().min(1.0).max(10.0),
  week: z.number().int().min(1).max(18),
  season: z.number().int().min(2024).max(2026),
  opponent: z.string().trim().length(3).regex(/^[A-Z]{3}$/),
  game_time: z.string().datetime(),
});

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get JWT from authorization header
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      console.error('No authorization header');
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Create client with service role key for database access (bypasses RLS)
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);
    
    // Create separate client with JWT for auth verification
    const token = authHeader.replace('Bearer ', '');
    const supabaseAuth = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false }
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !user) {
      console.error('Auth error:', authError?.message || 'No user');
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    console.log("User authenticated:", user.id);

    console.log("Authenticated user:", user.id);

    // Check if user has admin role
    const { data: hasAdminRole, error: roleError } = await supabaseClient.rpc(
      "has_role",
      { _user_id: user.id, _role: "admin" }
    );

    if (roleError || !hasAdminRole) {
      console.error("Role check error:", roleError);
      return new Response(
        JSON.stringify({ error: "Forbidden: Admin access required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 }
      );
    }

    const body = await req.json();
    
    // Validate input
    const validationResult = propSchema.safeParse(body);
    if (!validationResult.success) {
      return new Response(
        JSON.stringify({ 
          error: "Invalid input", 
          details: validationResult.error.issues 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const propData = validationResult.data;

    // Generate player_id
    const player_id = `${propData.player_name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;

    // Insert the prop
    const { data, error } = await supabaseClient
      .from("weekly_props")
      .insert([{
        ...propData,
        player_id,
        status: "pending"
      }])
      .select()
      .single();

    if (error) {
      console.error("Error creating prop:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    console.log("Prop created successfully:", data);

    return new Response(
      JSON.stringify({ success: true, data }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    console.error("Unexpected error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
