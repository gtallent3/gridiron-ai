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
    const season = 2025;
    
    // Get the latest week with actual stats from player_pool_v2 to determine current week
    const { data: latestActualWeeks } = await supabase
      .from('player_pool_v2')
      .select('week')
      .eq('season', season)
      .not('actual_fp', 'is', null)
      .order('week', { ascending: false })
      .limit(1);
    
    // Current week is one after the latest week with actual stats
    const currentWeek = latestActualWeeks && latestActualWeeks.length > 0 
      ? latestActualWeeks[0].week + 1 
      : 1;
    
    console.log(`Computing player rankings for season ${season}, current week: ${currentWeek}`);

    // Fetch actuals from player_pool_v2 (actual_fp)
    // Use lte to include the current week if it has actual data
    const { data: actualsData, error: actualsError } = await supabase
      .from('player_pool_v2')
      .select('canonical_player_id, player_name, position, team, week, actual_fp')
      .eq('season', season)
      .not('actual_fp', 'is', null)
      .lte('week', currentWeek)
      .in('position', ['QB', 'RB', 'WR', 'TE'])
      .not('team', 'is', null)
      .limit(10000);

    if (actualsError) throw actualsError;

    // Fetch projections from player_pool_v2 (projected_fp)
    const { data: projectionsData, error: projectionsError } = await supabase
      .from('player_pool_v2')
      .select('canonical_player_id, player_name, position, team, week, projected_fp')
      .eq('season', season)
      .not('projected_fp', 'is', null)
      .gte('week', currentWeek)
      .in('position', ['QB', 'RB', 'WR', 'TE'])
      .not('team', 'is', null)
      .limit(10000);

    if (projectionsError) throw projectionsError;

    const actuals = actualsData || [];
    const projections = projectionsData || [];

    const actualCount = actuals.length;
    const projCount = projections.length;
    const nonZeroProjCount = projections.filter(p => Number(p.projected_fp || 0) > 0).length;
    console.log(`Fetched from player_pool_v2 - actuals: ${actualCount}, projections: ${projCount}, non-zero projections: ${nonZeroProjCount}`);

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

    // Normalize player name by removing suffixes
    const normalizeName = (name: string): string => {
      return name
        .replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
        .trim();
    };

    // Normalize team abbreviations
    const normalizeTeam = (team: string): string => {
      if (team === 'LAR') return 'LA';
      return team;
    };

    // Build a complete player map from both actuals and projections
    // Use composite key: normalized_name:position to handle cross-team changes and avoid duplicates
    const allPlayers = new Map<string, { player_id: string, player_name: string, position: string, team: string }>();
    
    // Add all players from actuals (only if not present yet)
    for (const act of actuals || []) {
      if (act.team && act.player_name && act.position) {
        const normalizedName = normalizeName(act.player_name);
        const key = `${normalizedName}:${act.position}`;
        if (!allPlayers.has(key)) {
          allPlayers.set(key, {
            player_id: act.canonical_player_id,
            player_name: act.player_name,
            position: act.position,
            team: normalizeTeam(act.team)
          });
        }
      }
    }
    
    // Merge players from projections (overwrite to prefer projection ids/teams when available)
    for (const proj of projections || []) {
      if (proj.team && proj.player_name && proj.position) {
        const normalizedName = normalizeName(proj.player_name);
        const key = `${normalizedName}:${proj.position}`;
        const existing = allPlayers.get(key);
        if (!existing) {
          allPlayers.set(key, {
            player_id: proj.canonical_player_id,
            player_name: proj.player_name,
            position: proj.position,
            team: normalizeTeam(proj.team)
          });
        } else {
          // Prefer projection identifiers/team for ROS context
          allPlayers.set(key, {
            player_id: proj.canonical_player_id || existing.player_id,
            player_name: existing.player_name || proj.player_name,
            position: existing.position,
            team: normalizeTeam(proj.team) || existing.team,
          });
        }
      }
    }

    // Group projections by normalized_name:position
    const playerProjections = new Map<string, any[]>();
    for (const proj of projections || []) {
      const normalizedName = normalizeName(proj.player_name);
      const key = `${normalizedName}:${proj.position}`;
      if (!playerProjections.has(key)) {
        playerProjections.set(key, []);
      }
      playerProjections.get(key)!.push(proj);
    }

    // Group actuals by normalized_name:position
    const playerActuals = new Map<string, any[]>();
    for (const act of actuals || []) {
      const normalizedName = normalizeName(act.player_name);
      const key = `${normalizedName}:${act.position}`;
      if (!playerActuals.has(key)) {
        playerActuals.set(key, []);
      }
      playerActuals.get(key)!.push(act);
    }

    // Compute rankings for all players
    const rankings = [] as any[];
    const debugCounts = { withProjs: 0, withNonZeroProjs: 0, noProjs: 0, projectedGt0: 0 };
    const anomalySamples: any[] = [];

    for (const [playerKey, playerInfo] of allPlayers.entries()) {
      // Get projections and actuals for this player using composite key
      const projs = playerProjections.get(playerKey) || [];
      const acts = playerActuals.get(playerKey) || [];

      // Skip players with no actual stats AND no projections
      if (projs.length === 0 && acts.length === 0) continue;

      // Filter out players that are out for the season (projected_fp == 0 for both weeks 17 AND 18)
      if (projs.length > 0) {
        const week17Proj = projs.find(p => p.week === 17);
        const week18Proj = projs.find(p => p.week === 18);
        
        const week17Pts = week17Proj ? Number(week17Proj.projected_fp || 0) : 1;
        const week18Pts = week18Proj ? Number(week18Proj.projected_fp || 0) : 1;
        
        if (week17Pts === 0 && week18Pts === 0) {
          continue; // Player is out for the season
        }
      }

      // Calculate average projected PPG for ROS (only include weeks with projections > 0)
      // Missing weeks are not penalized (injured players)
      const validProjs = projs.filter(p => Number(p.projected_fp || 0) > 0);
      const totalProjPts = validProjs.reduce((sum, p) => sum + Number(p.projected_fp || 0), 0);
      const avgProjectedPpgRos = validProjs.length > 0 ? totalProjPts / validProjs.length : 0;

      // Calculate average actual PPG from past weeks (only include weeks with actual data)
      // Missing weeks are not penalized (injured players)
      const validActs = acts.filter((a: any) => a.actual_fp != null && Number(a.actual_fp) >= 0);
      const totalActualPts = validActs.reduce((sum, a) => sum + Number(a.actual_fp || 0), 0);
      const avgActualPpg = validActs.length > 0 ? totalActualPts / validActs.length : 0;

      // Debug counts
      if (projs.length > 0) debugCounts.withProjs++; else debugCounts.noProjs++;
      if (validProjs.length > 0) debugCounts.withNonZeroProjs++;
      if (avgProjectedPpgRos > 0) debugCounts.projectedGt0++;
      if (avgProjectedPpgRos === 0 && validProjs.length > 0 && anomalySamples.length < 5) {
        anomalySamples.push({ player: playerInfo.player_name, position: playerInfo.position, team: playerInfo.team, projs: projs.map(p => ({ week: p.week, pts: Number(p.projected_fp || 0) })) });
      }

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

    console.log('Projection debug summary:', JSON.stringify(debugCounts));
    if (anomalySamples.length > 0) {
      console.log('Projection anomalies (expected >0 but got 0) sample:', JSON.stringify(anomalySamples));
    }

    // Deduplicate by player_id to avoid unique constraint violations
    const rankingsById = new Map<string, any>();
    for (const r of rankings) {
      const existing = rankingsById.get(r.player_id);
      if (!existing) {
        rankingsById.set(r.player_id, r);
      } else {
        // Prefer entry with projections; otherwise higher actual PPG
        const pick = (r.avg_projected_ppg_ros ?? 0) > (existing.avg_projected_ppg_ros ?? 0)
          ? r
          : ((r.avg_projected_ppg_ros ?? 0) === (existing.avg_projected_ppg_ros ?? 0) && (r.avg_actual_ppg ?? 0) > (existing.avg_actual_ppg ?? 0) ? r : existing);
        rankingsById.set(r.player_id, pick);
      }
    }
    const dedupedRankings = Array.from(rankingsById.values());

    console.log(`Computed ${rankings.length} player rankings, ${dedupedRankings.length} after dedupe`);

    // Upsert to player_rankings table
    if (dedupedRankings.length > 0) {
      // Delete existing rankings for this season first
      await supabase
        .from('player_rankings')
        .delete()
        .eq('season', season);

      // Insert new rankings in chunks
      const chunkSize = 500;
      for (let i = 0; i < dedupedRankings.length; i += chunkSize) {
        const chunk = dedupedRankings.slice(i, i + chunkSize);
        const { error: upsertError } = await supabase
          .from('player_rankings')
          .upsert(chunk, { onConflict: 'player_id,season', ignoreDuplicates: false });

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
        playersProcessed: dedupedRankings.length,
        season,
        currentWeek,
        message: 'Player rankings computed and saved',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error computing player rankings:', error);
    const errPayload = typeof error === 'string' 
      ? { error }
      : (error && typeof error === 'object' && 'message' in (error as any))
        ? { error: (error as any).message, details: error }
        : { error: 'Unknown error', details: error };
    return new Response(
      JSON.stringify(errPayload),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
