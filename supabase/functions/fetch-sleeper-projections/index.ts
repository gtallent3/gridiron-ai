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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Verify admin role
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });

    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const season = 2025;
    const allProjections = [];
    let totalFetched = 0;
    let totalSaved = 0;

    console.log("Starting Sleeper projection fetch for season", season);

    // Fetch projections for all 18 weeks
    for (let week = 1; week <= 18; week++) {
      const url = `https://api.sleeper.app/v1/projections/nfl/regular/${season}/${week}`;
      
      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.log(`Week ${week}: API returned ${response.status}`);
          continue;
        }

        const data = await response.json();
        
        if (!Array.isArray(data) || data.length === 0) {
          console.log(`Week ${week}: No data available`);
          continue;
        }

        console.log(`Week ${week}: Fetched ${data.length} players`);
        totalFetched += data.length;

        // Transform and prepare data for insertion
        const projections = data.map((player) => ({
          player_id: player.player_id,
          week: week,
          season: season,
          team: player.team || null,
          position: player.position || null,
          pts_std: player.stats?.pts_std || 0,
          pts_ppr: player.stats?.pts_ppr || 0,
          pts_half_ppr: player.stats?.pts_half_ppr || 0,
          pass_yd: player.stats?.pass_yd || 0,
          pass_td: player.stats?.pass_td || 0,
          pass_int: player.stats?.pass_int || 0,
          rush_yd: player.stats?.rush_yd || 0,
          rush_td: player.stats?.rush_td || 0,
          rec: player.stats?.rec || 0,
          rec_yd: player.stats?.rec_yd || 0,
          rec_td: player.stats?.rec_td || 0,
          raw_stats: player.stats || {},
        }));

        // Insert in batches
        const { error: insertError, count } = await supabase
          .from("sleeper_projections")
          .upsert(projections, { 
            onConflict: "player_id,week,season",
            count: "exact"
          });

        if (insertError) {
          console.error(`Week ${week}: Insert error:`, insertError);
        } else {
          totalSaved += count || 0;
          console.log(`Week ${week}: Saved ${count} projections`);
        }

      } catch (error) {
        console.error(`Week ${week}: Error:`, error);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Fetched ${totalFetched} projections, saved ${totalSaved} to database`,
        season,
        totalFetched,
        totalSaved,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});