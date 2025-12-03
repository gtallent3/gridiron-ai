import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";

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
    
    // Determine current week (max of latest actuals between player_pool_v2 and actual_weekly_points) + 1
    let currentWeek = 1;
    let latestV2Week = 0;
    let latestNflWeek = 0;

    if (latestActualWeeks && latestActualWeeks.length > 0) {
      latestV2Week = (latestActualWeeks[0] as any).week;
    }

    const { data: nflLatest, error: nflWeekErr } = await supabase
      .from('actual_weekly_points')
      .select('week')
      .eq('season', season)
      .order('week', { ascending: false })
      .limit(1);
    if (nflWeekErr) {
      console.warn('Fallback currentWeek lookup failed:', nflWeekErr);
    }
    if (nflLatest && nflLatest.length > 0) {
      latestNflWeek = (nflLatest[0] as any).week;
    }

    const latestActualWeek = Math.max(latestV2Week || 0, latestNflWeek || 0);
    currentWeek = (latestActualWeek > 0 ? latestActualWeek : 0) + 1;
    console.log(`Computing player rankings for season ${season}, current week: ${currentWeek} (latestV2Week: ${latestV2Week}, latestNflWeek: ${latestNflWeek})`);

    const pageSize = 1000;

    // Fetch actuals from actual_weekly_points
    const { data: nflActualsData, error: nflActualsError } = await supabase
      .from('actual_weekly_points')
      .select('player_id, player_name, position, team, week, fantasy_points_ppr, passing_yards, passing_tds, passing_ints, rushing_yards, rushing_tds, receptions, receiving_yards, receiving_tds')
      .eq('season', season)
      .lte('week', currentWeek)
      .in('position', ['QB', 'RB', 'WR', 'TE'])
      .not('team', 'is', null)
      .order('player_id', { ascending: true })
      .order('week', { ascending: true });

    if (nflActualsError) throw nflActualsError;

    // Fetch projections from player_pool_v2 (projected_fp)
    // Explicitly exclude kickers (K) from rankings
    const { data: projectionsData, error: projectionsError } = await supabase
      .from('player_pool_v2')
      .select('canonical_player_id, player_name, position, team, week, projected_fp, ros_sos_rank, playoff_sos_rank')
      .eq('season', season)
      .not('projected_fp', 'is', null)
      .gte('week', currentWeek)
      .in('position', ['QB', 'RB', 'WR', 'TE'])
      .not('team', 'is', null)
      .order('canonical_player_id', { ascending: true })
      .order('week', { ascending: true });

    if (projectionsError) throw projectionsError;

    // Fetch ALL canonical_players with pagination to map nfl_id to canonical_player_id
    let canonicalPlayersData: any[] = [];
    let canonicalFrom = 0;
    while (true) {
      const { data: batch, error: canonicalError } = await supabase
        .from('canonical_players')
        .select('id, nfl_id, player_name, position')
        .not('nfl_id', 'is', null)
        .range(canonicalFrom, canonicalFrom + pageSize - 1);
      
      if (canonicalError) throw canonicalError;
      if (!batch || batch.length === 0) break;
      
      canonicalPlayersData = canonicalPlayersData.concat(batch);
      if (batch.length < pageSize) break;
      canonicalFrom += pageSize;
    }
    
    console.log(`Fetched ${canonicalPlayersData.length} canonical players with nfl_id`);

    // Create lookup map: nfl_id -> canonical_player_id
    const nflIdToCanonical = new Map<string, string>();
    for (const cp of canonicalPlayersData || []) {
      if (cp.nfl_id) {
        nflIdToCanonical.set(cp.nfl_id, cp.id);
      }
    }
    
    // Debug: Check if specific players are in the map
    console.log('DEBUG nflIdToCanonical map size:', nflIdToCanonical.size);
    console.log('DEBUG Jefferson mapping:', {
      'Justin Jefferson (00-0036322)': nflIdToCanonical.get('00-0036322'),
      'Michael Pittman (00-0036252)': nflIdToCanonical.get('00-0036252'),
      'TreVeyon Henderson (00-0039163)': nflIdToCanonical.get('00-0039163')
    });

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

    // Make key preferring canonical_player_id, falling back to normalized name:position
    const makeKey = (row: {
      canonical_player_id?: string | null;
      player_name: string;
      position: string;
    }) => {
      if (row.canonical_player_id) return row.canonical_player_id;
      return `${normalizeName(row.player_name)}:${row.position}`;
    };

    // Collect ALL actuals from actual_weekly_points with pagination
    let nflActuals = nflActualsData || [];
    if (nflActuals.length === pageSize) {
      let from = pageSize;
      while (true) {
        const { data: more, error: moreErr } = await supabase
          .from('actual_weekly_points')
          .select('player_id, player_name, position, team, week, fantasy_points_ppr, passing_yards, passing_tds, passing_ints, rushing_yards, rushing_tds, receptions, receiving_yards, receiving_tds')
          .eq('season', season)
          .lte('week', currentWeek)
          .in('position', ['QB', 'RB', 'WR', 'TE'])
          .not('team', 'is', null)
          .order('player_id', { ascending: true })
          .order('week', { ascending: true })
          .range(from, from + pageSize - 1);
        if (moreErr) throw moreErr;
        if (!more || more.length === 0) break;
        nflActuals = nflActuals.concat(more as any);
        if (more.length < pageSize) break;
        from += pageSize;
      }
    }

    // Map actual_weekly_points to actuals with canonical_player_id
    const actualsBeforeFilter = nflActuals.map((nfl: any) => ({
      canonical_player_id: nflIdToCanonical.get(nfl.player_id) || null,
      player_name: nfl.player_name,
      position: nfl.position,
      team: normalizeTeam(nfl.team),
      week: nfl.week,
      actual_fp: Number(nfl.fantasy_points_ppr || 0),
      nfl_player_id: nfl.player_id // For debugging
    }));
    
    // Debug: Check specific players before filtering
    const jeffersonBefore = actualsBeforeFilter.filter(a => a.player_name.includes('Jefferson'));
    console.log('DEBUG Jefferson actuals before filter:', JSON.stringify(jeffersonBefore.slice(0, 5).map(a => ({
      name: a.player_name,
      nfl_id: a.nfl_player_id,
      canonical_id: a.canonical_player_id,
      week: a.week
    }))));
    
    const actuals = actualsBeforeFilter.filter(a => a.canonical_player_id); // Only include players with canonical mapping

    // Collect ALL projections with pagination
    let projections = projectionsData || [];
    if (projections.length === pageSize) {
      let from = pageSize;
      while (true) {
        const { data: more, error: moreErr } = await supabase
          .from('player_pool_v2')
          .select('canonical_player_id, player_name, position, team, week, projected_fp, ros_sos_rank, playoff_sos_rank')
          .eq('season', season)
          .not('projected_fp', 'is', null)
          .gte('week', currentWeek)
          .in('position', ['QB','RB','WR','TE'])
          .not('team', 'is', null)
          .order('canonical_player_id', { ascending: true })
          .order('week', { ascending: true })
          .range(from, from + pageSize - 1);
        if (moreErr) throw moreErr;
        if (!more || more.length === 0) break;
        projections = projections.concat(more as any);
        if (more.length < pageSize) break;
        from += pageSize;
      }
    }

    console.log(`Fetched ${actuals.length} actuals from actual_weekly_points and ${projections.length} projections from player_pool_v2`);
    
    // Debug: Check specific players' raw data
    const debugPlayers = ['Justin Jefferson', 'Michael Pittman', 'TreVeyon Henderson'];
    for (const playerName of debugPlayers) {
      const playerActuals = actuals.filter((a: any) => a.player_name?.includes(playerName.split(' ')[1]));
      if (playerActuals.length > 0) {
        console.log(`DEBUG ${playerName} raw actuals:`, JSON.stringify(playerActuals.slice(0, 3).map((a: any) => ({
          canonical_id: a.canonical_player_id,
          name: a.player_name,
          week: a.week,
          actual_fp: a.actual_fp,
          team: a.team
        }))));
      }
    }

    // Fetch bye weeks from player_pool_v2 (where bye_week=true), with pagination and only relevant positions
    const byeWeekMap = new Map<string, number>();
    {
      let from = 0;
      while (true) {
        const { data: byeBatch, error: byeError } = await supabase
          .from('player_pool_v2')
          .select('canonical_player_id, week')
          .eq('season', season)
          .eq('bye_week', true)
          .in('position', ['QB', 'RB', 'WR', 'TE'])
          .range(from, from + pageSize - 1);
        if (byeError) throw byeError;
        if (!byeBatch || byeBatch.length === 0) break;
        for (const bye of byeBatch) {
          if (bye.canonical_player_id) {
            byeWeekMap.set(bye.canonical_player_id, bye.week);
          }
        }
        if (byeBatch.length < pageSize) break;
        from += pageSize;
      }
    }

    // Build a complete player map from both actuals and projections
    // Use canonical_player_id as primary key, fallback to normalized_name:position
    const allPlayers = new Map<string, { player_id: string, player_name: string, position: string, team: string }>();
    
    // Add all players from actuals
    for (const act of actuals || []) {
      if (!act.team || !act.player_name || !act.position) continue;

      const key = makeKey(act);
      const existing = allPlayers.get(key);

      if (!existing) {
        allPlayers.set(key, {
          player_id: act.canonical_player_id || key,
          player_name: act.player_name,
          position: act.position,
          team: normalizeTeam(act.team),
        });
      } else {
        // Prefer non-null team/name from actuals
        allPlayers.set(key, {
          ...existing,
          player_name: existing.player_name || act.player_name,
          team: existing.team || normalizeTeam(act.team),
        });
      }
    }
    
    // Merge players from projections
    for (const proj of projections || []) {
      if (!proj.team || !proj.player_name || !proj.position) continue;

      const key = makeKey(proj);
      const existing = allPlayers.get(key);

      if (!existing) {
        allPlayers.set(key, {
          player_id: proj.canonical_player_id || key,
          player_name: proj.player_name,
          position: proj.position,
          team: normalizeTeam(proj.team),
        });
      } else {
        allPlayers.set(key, {
          player_id: proj.canonical_player_id || existing.player_id || key,
          player_name: existing.player_name || proj.player_name,
          position: existing.position,
          team: normalizeTeam(proj.team) || existing.team,
        });
      }
    }

    // Group projections using same key strategy
    const playerProjections = new Map<string, any[]>();
    for (const proj of projections || []) {
      const key = makeKey(proj);
      if (!playerProjections.has(key)) playerProjections.set(key, []);
      playerProjections.get(key)!.push(proj);
    }

    // Group actuals using same key strategy
    const playerActuals = new Map<string, any[]>();
    for (const act of actuals || []) {
      const key = makeKey(act);
      if (!playerActuals.has(key)) playerActuals.set(key, []);
      playerActuals.get(key)!.push(act);
    }
    console.log(`Grouped ${playerActuals.size} unique players with actuals`);

    // Compute rankings for all players
    const rankings = [] as any[];
    const debugCounts = { withProjs: 0, withNonZeroProjs: 0, noProjs: 0, projectedGt0: 0 };
    const anomalySamples: any[] = [];

    for (const [playerKey, playerInfo] of allPlayers.entries()) {
      // Get projections and actuals for this player using same key
      const projs = playerProjections.get(playerKey) || [];
      const acts = playerActuals.get(playerKey) || [];

      // Skip players with no actual stats AND no projections
      if (projs.length === 0 && acts.length === 0) continue;


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

      // Calculate last 3 weeks actual PPG (weeks: currentWeek-3, currentWeek-2, currentWeek-1)
      const last3Weeks = [currentWeek - 3, currentWeek - 2, currentWeek - 1];
      const last3Acts = validActs.filter((a: any) => last3Weeks.includes(a.week));
      const totalLast3Pts = last3Acts.reduce((sum, a) => sum + Number(a.actual_fp || 0), 0);
      const actualLast3Ppg = last3Acts.length > 0 ? totalLast3Pts / last3Acts.length : 0;

      // Calculate season PPG excluding last 3 weeks
      const seasonActs = validActs.filter((a: any) => !last3Weeks.includes(a.week));
      const totalSeasonPts = seasonActs.reduce((sum, a) => sum + Number(a.actual_fp || 0), 0);
      const actualSeasonPpg = seasonActs.length > 0 ? totalSeasonPts / seasonActs.length : 0;

      // Debug counts
      if (projs.length > 0) debugCounts.withProjs++; else debugCounts.noProjs++;
      if (validProjs.length > 0) debugCounts.withNonZeroProjs++;
      if (avgProjectedPpgRos > 0) debugCounts.projectedGt0++;
      if (avgProjectedPpgRos === 0 && validProjs.length > 0 && anomalySamples.length < 5) {
        anomalySamples.push({ player: playerInfo.player_name, position: playerInfo.position, team: playerInfo.team, projs: projs.map(p => ({ week: p.week, pts: Number(p.projected_fp || 0) })) });
      }

      // Targeted debug for specific players
      const isDebugPlayer = ['Jefferson', 'Pittman', 'Henderson'].some(n => playerInfo.player_name.includes(n));
      if (isDebugPlayer) {
        console.log(`DEBUG ${playerInfo.player_name}:`, JSON.stringify({
          playerKey,
          canonical_id: playerInfo.player_id,
          currentWeek,
          acts_count: acts.length,
          acts_sample: acts.slice(0, 2).map((a: any) => ({ week: a.week, actual_fp: a.actual_fp })),
          projs_count: projs.length,
          avgActualPpg,
          actualLast3Ppg,
          actualSeasonPpg,
          avgProjectedPpgRos
        }));
      }

      // Get SOS rankings from projections (use the latest week's projection with SOS data for most current schedule)
      const projWithSos = projs
        .filter(p => p.ros_sos_rank != null || p.playoff_sos_rank != null)
        .sort((a, b) => b.week - a.week)[0]; // Get most recent week with SOS data
      const rosSosRank = projWithSos?.ros_sos_rank ?? null;
      const playoffSosRank = projWithSos?.playoff_sos_rank ?? null;

      // Get bye week from player_pool_v2 data using canonical_player_id directly
      // Only look up if playerInfo.player_id is a UUID (canonical_player_id), not a fallback key
      const byeWeek = (playerInfo.player_id && playerInfo.player_id.includes('-')) 
        ? byeWeekMap.get(playerInfo.player_id) ?? null 
        : null;

      rankings.push({
        player_id: playerInfo.player_id,
        player_name: playerInfo.player_name,
        position: playerInfo.position,
        team: playerInfo.team,
        avg_projected_ppg_ros: avgProjectedPpgRos,
        avg_actual_ppg: avgActualPpg,
        actual_last3_ppg: actualLast3Ppg,
        actual_season_ppg: actualSeasonPpg,
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

    // Automatically compute trade values after rankings are updated
    console.log('Chaining to compute-trade-value-index...');
    try {
      const { error: tradeValueError } = await supabase.functions.invoke('compute-trade-value-index', {
        body: {}
      });
      if (tradeValueError) {
        console.error('Trade value computation failed:', tradeValueError);
      } else {
        console.log('Trade values computed successfully');
      }
    } catch (tvError) {
      console.error('Error invoking compute-trade-value-index:', tvError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        playersProcessed: dedupedRankings.length,
        season,
        currentWeek,
        message: 'Player rankings and trade values computed and saved',
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
