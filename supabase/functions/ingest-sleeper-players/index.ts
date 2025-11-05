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

    // Define background task function
    async function ingestAllPlayers() {
      console.log("Starting Sleeper player ingestion");

      try {
        // Fetch all players from Sleeper API
        const response = await fetch("https://api.sleeper.app/v1/players/nfl");
        if (!response.ok) {
          console.error(`Sleeper API returned ${response.status}: ${response.statusText}`);
          return;
        }

        const data = await response.json();
        console.log(`Fetched player data, type: ${typeof data}, is object: ${data && typeof data === 'object'}`);

        // Sleeper returns players as object with player_id as keys
        const playerEntries = Object.entries(data);
        console.log(`Total players from API: ${playerEntries.length}`);

        // Transform to normalized format
        const players = playerEntries
          .map(([sleeperId, player]: [string, any]) => {
            // Only include active NFL players with names
            if (!player.player_id || !player.full_name || player.sport !== 'nfl') {
              return null;
            }

            return {
              player_id: `sleeper_${sleeperId}`, // Prefix to avoid conflicts
              sleeper_id: sleeperId,
              player_name: player.full_name || player.first_name + ' ' + player.last_name,
              position: player.position || player.fantasy_positions?.[0] || null,
              team: player.team || null,
              espn_id: player.espn_id?.toString() || null,
              yahoo_id: player.yahoo_id?.toString() || null,
              stats: {
                age: player.age,
                number: player.number,
                college: player.college,
                height: player.height,
                weight: player.weight,
                years_exp: player.years_exp,
                status: player.status,
                injury_status: player.injury_status,
              },
            };
          })
          .filter(Boolean);

        console.log(`Prepared ${players.length} valid players for upsert`);

        // Upsert in chunks to avoid memory/CPU issues
        const chunkSize = 500;
        let totalSaved = 0;

        for (let i = 0; i < players.length; i += chunkSize) {
          const chunk = players.slice(i, i + chunkSize);
          
          const { error: upsertError } = await supabase
            .from("normalized_players")
            .upsert(chunk, {
              onConflict: "player_id",
            });

          if (upsertError) {
            console.error(`Chunk ${Math.floor(i / chunkSize) + 1} error:`, upsertError);
          } else {
            totalSaved += chunk.length;
            console.log(`Saved chunk ${Math.floor(i / chunkSize) + 1} (${chunk.length} players). Total: ${totalSaved}`);
          }

          // Yield to event loop
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        console.log(`Completed: Saved ${totalSaved} players to normalized_players`);
      } catch (error) {
        console.error("Ingestion error:", error);
      }
    }

    // Start background task
    // @ts-ignore - EdgeRuntime is available in Deno Deploy
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(ingestAllPlayers());
    } else {
      // Fallback for local testing
      ingestAllPlayers().catch(err => console.error('Background task error:', err));
    }

    // Return immediate response
    return new Response(
      JSON.stringify({
        success: true,
        message: "Started ingesting Sleeper players. Check logs for progress.",
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
