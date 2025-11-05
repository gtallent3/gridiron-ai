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

    // Use current NFL season (2025)
    const season = 2025;

    // Helpers to coerce numeric types safely for DB columns
    const toNum = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const toInt = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : 0;
    };

    // Define background task function
    async function fetchAllProjections() {
      let totalFetched = 0;
      let totalSaved = 0;

      console.log("Starting Sleeper projection fetch for season", season);

      // Fetch projections for all 18 weeks
      for (let week = 1; week <= 18; week++) {
      const url = `https://api.sleeper.app/v1/projections/nfl/regular/${season}/${week}`;
      
      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.log(`Week ${week}: API returned ${response.status}, ${response.statusText}`);
          continue;
        }

        const data = await response.json();
        console.log(`Week ${week}: Response type: ${typeof data}, isArray: ${Array.isArray(data)}, length: ${Array.isArray(data) ? data.length : (data && typeof data === 'object' ? Object.keys(data).length : 'N/A')}`);
        
        let isEmpty = false;
        if (Array.isArray(data)) {
          isEmpty = data.length === 0;
        } else if (data && typeof data === 'object') {
          isEmpty = Object.keys(data).length === 0;
        } else {
          isEmpty = true;
        }
        if (isEmpty) {
          console.log(`Week ${week}: No data available (data: ${JSON.stringify(data).substring(0, 200)})`);
          continue;
        }

        const fetchedCount = Array.isArray(data) ? data.length : Object.keys(data).length;
        console.log(`Week ${week}: Fetched ${fetchedCount} entries`);
        totalFetched += fetchedCount;

        // Transform and prepare data for insertion (handle array or object shapes)
        let projections: any[] = [];
        if (Array.isArray(data)) {
          projections = data.map((player: any) => {
            const stats = player.stats ?? player;
          return {
            player_id: player.player_id ?? player.id ?? null,
            week,
            season,
            team: player.team ?? player.team_abbr ?? null,
            position: player.position ?? player.pos ?? null,
            pts_std: toNum(stats?.pts_std),
            pts_ppr: toNum(stats?.pts_ppr),
            pts_half_ppr: toNum(stats?.pts_half_ppr),
            pass_yd: toNum(stats?.pass_yd),
            pass_td: toInt(stats?.pass_td),
            pass_int: toInt(stats?.pass_int),
            rush_yd: toNum(stats?.rush_yd),
            rush_td: toInt(stats?.rush_td),
            rec: toNum(stats?.rec),
            rec_yd: toNum(stats?.rec_yd),
            rec_td: toInt(stats?.rec_td),
            raw_stats: stats ?? {},
          };
          });
        } else if (data && typeof data === 'object') {
          projections = Object.entries(data).map(([playerId, stats]: [string, any]) => ({
            player_id: stats?.player_id ?? playerId,
            week,
            season,
            team: stats?.team ?? stats?.team_abbr ?? null,
            position: stats?.position ?? stats?.pos ?? null,
            pts_std: toNum(stats?.pts_std),
            pts_ppr: toNum(stats?.pts_ppr),
            pts_half_ppr: toNum(stats?.pts_half_ppr),
            pass_yd: toNum(stats?.pass_yd),
            pass_td: toInt(stats?.pass_td),
            pass_int: toInt(stats?.pass_int),
            rush_yd: toNum(stats?.rush_yd),
            rush_td: toInt(stats?.rush_td),
            rec: toNum(stats?.rec),
            rec_yd: toNum(stats?.rec_yd),
            rec_td: toInt(stats?.rec_td),
            raw_stats: stats ?? {},
          }));
        }

        if (!projections.length) {
          console.log(`Week ${week}: Parsed 0 projections from response shape.`);
          continue;
        }

        console.log(`Week ${week}: Prepared ${projections.length} projections for upsert`);

        // Lookup player names from normalized_players
        const playerIds = [...new Set(projections.map(p => p.player_id).filter(Boolean))];
        const { data: playerNames } = await supabase
          .from('normalized_players')
          .select('sleeper_id, player_name')
          .in('sleeper_id', playerIds);

        // Create a map of player_id -> player_name
        const nameMap = new Map(
          (playerNames || []).map(p => [p.sleeper_id, p.player_name])
        );

        // Add player names to projections
        projections.forEach(proj => {
          proj.player_name = nameMap.get(proj.player_id) || null;
        });

        console.log(`Week ${week}: Mapped ${nameMap.size} player names`);

        // Insert in smaller chunks to avoid CPU timeouts
        const chunkSize = 500;
        for (let i = 0; i < projections.length; i += chunkSize) {
          const chunk = projections.slice(i, i + chunkSize);
          const { error: insertError } = await supabase
            .from("sleeper_projections")
            .upsert(chunk, { 
              onConflict: "player_id,week,season"
            });

          if (insertError) {
            console.error(`Week ${week}: Upsert chunk ${Math.floor(i / chunkSize) + 1} error:`, insertError);
          } else {
            totalSaved += chunk.length;
            console.log(`Week ${week}: Saved chunk ${Math.floor(i / chunkSize) + 1} (${chunk.length})`);
          }

          // Yield to event loop to avoid long CPU blocks
          await new Promise((resolve) => setTimeout(resolve, 0));
        }


        } catch (error) {
          console.error(`Week ${week}: Error:`, error);
        }
      }

      console.log(`Completed: Fetched ${totalFetched} projections, saved ${totalSaved} to database`);
    }

    // Start background task
    // @ts-ignore - EdgeRuntime is available in Deno Deploy
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(fetchAllProjections());
    } else {
      // Fallback for local testing
      fetchAllProjections().catch(err => console.error('Background task error:', err));
    }

    // Return immediate response
    return new Response(
      JSON.stringify({
        success: true,
        message: `Started fetching projections for season ${season}. Check logs for progress.`,
        season,
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