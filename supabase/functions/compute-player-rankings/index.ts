import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Determine season and current week from database
    // Use season 2025 as that's what the data is labeled with
    const season = 2025;
    
    // Get the latest week with actual stats to determine current week
    const { data: latestActualWeeks } = await supabase
      .from('nfl_fantasy_points')
      .select('week')
      .eq('season', season)
      .order('week', { ascending: false })
      .limit(1);
    
    // Current week is one after the latest week with actual stats
    const currentWeek = latestActualWeeks && latestActualWeeks.length > 0 
      ? latestActualWeeks[0].week + 1 
      : 1;
    
    console.log(`Computing player rankings for season ${season}, current week: ${currentWeek}`);

    // Fetch actual stats for past weeks (to get all players who have played)
    const { data: actuals, error: actualsError } = await supabase
      .from('nfl_fantasy_points')
      .select('player_id, player_name, position, team, fantasy_points_ppr, week')
      .eq('season', season)
      .lt('week', currentWeek)
      .in('position', ['QB', 'RB', 'WR', 'TE'])
      .not('team', 'is', null);

    if (actualsError) throw actualsError;

    // Fetch all ROS projections (current week onwards)
    const { data: projections, error: projError } = await supabase
      .from('sleeper_projections')
      .select('player_id, player_name, position, team, week, pts_ppr')
      .eq('season', season)
      .gte('week', currentWeek)
      .in('position', ['QB', 'RB', 'WR', 'TE'])
      .not('team', 'is', null);

    if (projError) throw projError;

    // Fetch SOS data
    const { data: sosData, error: sosError } = await supabase
      .from('strength_of_schedule')
      .select('team, def_rank_qb, def_rank_rb, def_rank_wr, def_rank_te')
      .eq('season', season);

    if (sosError) throw sosError;

    // Create SOS maps for ROS and playoff
    const sosRankMap = new Map<string, { ros: number, playoff: number }>();
    (sosData || []).forEach((row: any) => {
      if (row.def_rank_qb != null) sosRankMap.set(`${row.team}:QB`, { ros: row.def_rank_qb, playoff: row.def_rank_qb });
      if (row.def_rank_rb != null) sosRankMap.set(`${row.team}:RB`, { ros: row.def_rank_rb, playoff: row.def_rank_rb });
      if (row.def_rank_wr != null) sosRankMap.set(`${row.team}:WR`, { ros: row.def_rank_wr, playoff: row.def_rank_wr });
      if (row.def_rank_te != null) sosRankMap.set(`${row.team}:TE`, { ros: row.def_rank_te, playoff: row.def_rank_te });
    });

    // Fetch bye weeks from team_schedules
    const { data: byeData, error: byeError } = await supabase
      .from('team_schedules')
      .select('team, week, opponent')
      .eq('season', season);

    if (byeError) throw byeError;

    // Build bye week map (week where opponent is 'BYE' or null)
    const byeWeekMap = new Map<string, number>();
    for (const sched of byeData || []) {
      if (!sched.opponent || sched.opponent === 'BYE') {
        byeWeekMap.set(sched.team, sched.week);
      }
    }

    // Build a complete player map from both actuals and projections
    // Use composite key: player_name:position to handle players with same name
    const allPlayers = new Map<string, { player_id: string, player_name: string, position: string, team: string }>();
    
    // Add all players from actuals
    for (const act of actuals || []) {
      if (act.team && act.player_name && act.position) {
        const key = `${act.player_name}:${act.position}`;
        allPlayers.set(key, {
          player_id: act.player_id,
          player_name: act.player_name,
          position: act.position,
          team: act.team
        });
      }
    }
    
    // Add players from projections (if not already present)
    for (const proj of projections || []) {
      if (proj.team && proj.player_name && proj.position) {
        const key = `${proj.player_name}:${proj.position}`;
        if (!allPlayers.has(key)) {
          allPlayers.set(key, {
            player_id: proj.player_id,
            player_name: proj.player_name,
            position: proj.position,
            team: proj.team
          });
        }
      }
    }

    // Group projections by player_name:position
    const playerProjections = new Map<string, any[]>();
    for (const proj of projections || []) {
      const key = `${proj.player_name}:${proj.position}`;
      if (!playerProjections.has(key)) {
        playerProjections.set(key, []);
      }
      playerProjections.get(key)!.push(proj);
    }

    // Group actuals by player_name:position
    const playerActuals = new Map<string, any[]>();
    for (const act of actuals || []) {
      const key = `${act.player_name}:${act.position}`;
      if (!playerActuals.has(key)) {
        playerActuals.set(key, []);
      }
      playerActuals.get(key)!.push(act);
    }

    // Compute rankings for all players
    const rankings = [];

    for (const [playerKey, playerInfo] of allPlayers.entries()) {
      // Get projections and actuals for this player using composite key
      const projs = playerProjections.get(playerKey) || [];
      const acts = playerActuals.get(playerKey) || [];

      // Skip players with no actual stats AND no projections
      if (projs.length === 0 && acts.length === 0) continue;

      // Filter out players that are out for the season (pts_ppr == 0 for both weeks 17 AND 18)
      if (projs.length > 0) {
        const week17Proj = projs.find(p => p.week === 17);
        const week18Proj = projs.find(p => p.week === 18);
        
        const week17Pts = week17Proj ? Number(week17Proj.pts_ppr || 0) : 1;
        const week18Pts = week18Proj ? Number(week18Proj.pts_ppr || 0) : 1;
        
        if (week17Pts === 0 && week18Pts === 0) {
          continue; // Player is out for the season
        }
      }

      // Calculate average projected PPG for ROS
      const totalProjPts = projs.reduce((sum, p) => sum + Number(p.pts_ppr || 0), 0);
      const avgProjectedPpgRos = projs.length > 0 ? totalProjPts / projs.length : 0;

      // Calculate average actual PPG from past weeks
      const totalActualPts = acts.reduce((sum, a) => sum + Number(a.fantasy_points_ppr || 0), 0);
      const avgActualPpg = acts.length > 0 ? totalActualPts / acts.length : 0;

      // Get SOS rankings
      const sosKey = `${playerInfo.team}:${playerInfo.position}`;
      const sos = sosRankMap.get(sosKey);
      const rosSosRank = sos?.ros ?? null;
      const playoffSosRank = sos?.playoff ?? null;

      // Get bye week
      const byeWeek = byeWeekMap.get(playerInfo.team) ?? null;

      rankings.push({
        player_id: playerInfo.player_id,
        player_name: playerInfo.player_name,
        position: playerInfo.position,
        team: playerInfo.team,
        avg_projected_ppg_ros: avgProjectedPpgRos,
        avg_actual_ppg: avgActualPpg,
        bye_week: byeWeek,
        ros_sos_rank: rosSosRank,
        playoff_sos_rank: playoffSosRank,
        season,
        current_week: currentWeek,
        updated_at: new Date().toISOString(),
      });
    }

    console.log(`Computed ${rankings.length} player rankings`);

    // Upsert to player_rankings table
    if (rankings.length > 0) {
      // Delete existing rankings for this season first
      await supabase
        .from('player_rankings')
        .delete()
        .eq('season', season);

      // Insert new rankings in chunks
      const chunkSize = 500;
      for (let i = 0; i < rankings.length; i += chunkSize) {
        const chunk = rankings.slice(i, i + chunkSize);
        const { error: upsertError } = await supabase
          .from('player_rankings')
          .insert(chunk);

        if (upsertError) {
          console.error(`Chunk ${Math.floor(i / chunkSize) + 1} error:`, upsertError);
          throw upsertError;
        }
        console.log(`Inserted chunk ${Math.floor(i / chunkSize) + 1}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        playersProcessed: rankings.length,
        season,
        currentWeek,
        message: 'Player rankings computed and saved',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error computing player rankings:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
