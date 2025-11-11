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
    
    console.log(`Building player pool for season ${season}, current week: ${currentWeek}`);

    // Normalize team abbreviations
    const normalizeTeam = (team: string): string => {
      if (team === 'LAR') return 'LA';
      return team;
    };

    // Fetch team schedules to identify bye weeks
    const { data: schedules, error: schedulesError } = await supabase
      .from('team_schedules')
      .select('team, week')
      .eq('season', season);
    
    if (schedulesError) throw schedulesError;
    
    // Create a set of team-week combinations that have games
    const teamWeeksWithGames = new Set<string>();
    for (const schedule of schedules || []) {
      teamWeeksWithGames.add(`${schedule.team}-${schedule.week}`);
    }

    // Fetch actual stats for past weeks (fetch all records with range)
    let allActuals: any[] = [];
    let actualsPage = 0;
    const pageSize = 1000;
    
    while (true) {
      const { data: actuals, error: actualsError } = await supabase
        .from('nfl_fantasy_points')
        .select('*')
        .eq('season', season)
        .lt('week', currentWeek)
        .in('position', ['QB', 'RB', 'WR', 'TE'])
        .not('team', 'is', null)
        .range(actualsPage * pageSize, (actualsPage + 1) * pageSize - 1);

      if (actualsError) throw actualsError;
      if (!actuals || actuals.length === 0) break;
      
      allActuals = allActuals.concat(actuals);
      actualsPage++;
      
      if (actuals.length < pageSize) break;
    }

    // Fetch Sleeper projections for current and future weeks
    let allSleeperProjections: any[] = [];
    let sleeperProjPage = 0;
    
    while (true) {
      const { data: projections, error: projError } = await supabase
        .from('sleeper_projections')
        .select('*')
        .eq('season', season)
        .gte('week', currentWeek)
        .in('position', ['QB', 'RB', 'WR', 'TE'])
        .not('team', 'is', null)
        .range(sleeperProjPage * pageSize, (sleeperProjPage + 1) * pageSize - 1);

      if (projError) throw projError;
      if (!projections || projections.length === 0) break;
      
      allSleeperProjections = allSleeperProjections.concat(projections);
      sleeperProjPage++;
      
      if (projections.length < pageSize) break;
    }

    // Fetch ESPN projections for current and future weeks
    let allEspnProjections: any[] = [];
    let espnProjPage = 0;
    
    while (true) {
      const { data: espnProj, error: espnError } = await supabase
        .from('projected_player_stats')
        .select('*')
        .eq('season', season)
        .gte('week', currentWeek)
        .in('position', ['QB', 'RB', 'WR', 'TE'])
        .not('team', 'is', null)
        .range(espnProjPage * pageSize, (espnProjPage + 1) * pageSize - 1);

      if (espnError) throw espnError;
      if (!espnProj || espnProj.length === 0) break;
      
      allEspnProjections = allEspnProjections.concat(espnProj);
      espnProjPage++;
      
      if (espnProj.length < pageSize) break;
    }

    // Fetch Sleeper projections for past weeks to fill DNP/bye gaps
    let allPastSleeperProjections: any[] = [];
    let pastSleeperPage = 0;
    while (true) {
      const { data: pastProjs, error: pastProjError } = await supabase
        .from('sleeper_projections')
        .select('*')
        .eq('season', season)
        .lt('week', currentWeek)
        .in('position', ['QB', 'RB', 'WR', 'TE'])
        .not('team', 'is', null)
        .range(pastSleeperPage * pageSize, (pastSleeperPage + 1) * pageSize - 1);

      if (pastProjError) throw pastProjError;
      if (!pastProjs || pastProjs.length === 0) break;

      allPastSleeperProjections = allPastSleeperProjections.concat(pastProjs);
      pastSleeperPage++;

      if (pastProjs.length < pageSize) break;
    }

    // Fetch ESPN projections for past weeks to fill DNP/bye gaps
    let allPastEspnProjections: any[] = [];
    let pastEspnPage = 0;
    while (true) {
      const { data: pastEspn, error: pastEspnError } = await supabase
        .from('projected_player_stats')
        .select('*')
        .eq('season', season)
        .lt('week', currentWeek)
        .in('position', ['QB', 'RB', 'WR', 'TE'])
        .not('team', 'is', null)
        .range(pastEspnPage * pageSize, (pastEspnPage + 1) * pageSize - 1);

      if (pastEspnError) throw pastEspnError;
      if (!pastEspn || pastEspn.length === 0) break;

      allPastEspnProjections = allPastEspnProjections.concat(pastEspn);
      pastEspnPage++;

      if (pastEspn.length < pageSize) break;
    }

    console.log(`Fetched ${allActuals.length} actual, ${allPastSleeperProjections.length} past Sleeper, ${allPastEspnProjections.length} past ESPN, ${allSleeperProjections.length} future Sleeper, and ${allEspnProjections.length} future ESPN projection records`);

    // Normalize player name by removing suffixes
    const normalizeName = (name: string): string => {
      return name
        .replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
        .trim();
    };

    // Build player pool records using a Map to ensure uniqueness
    // Key format: "normalized_name:position-week-season" to handle cross-source player_id differences
    const poolMap = new Map<string, any>();

    // Add actual stats (past weeks) - these take priority
    for (const actual of allActuals) {
      const normalizedTeam = normalizeTeam(actual.team);
      let opponent = actual.opponent;
      
      // If opponent is null, check if it's a bye week
      if (!opponent) {
        const hasGame = teamWeeksWithGames.has(`${normalizedTeam}-${actual.week}`);
        if (!hasGame) {
          opponent = 'BYE';
        }
      }
      
      const normalizedName = normalizeName(actual.player_name);
      const key = `${normalizedName}:${actual.position}-${actual.week}-${actual.season}`;
      poolMap.set(key, {
        player_id: actual.player_id,
        player_name: actual.player_name,
        position: actual.position,
        team: normalizedTeam,
        week: actual.week,
        season: actual.season,
        points_ppr: actual.fantasy_points_ppr || 0,
        is_actual: true,
        did_not_play: false,
        passing_yards: actual.passing_yards || 0,
        passing_tds: actual.passing_tds || 0,
        passing_ints: actual.passing_ints || 0,
        rushing_yards: actual.rushing_yards || 0,
        rushing_tds: actual.rushing_tds || 0,
        receptions: actual.receptions || 0,
        receiving_yards: actual.receiving_yards || 0,
        receiving_tds: actual.receiving_tds || 0,
        opponent: opponent,
        opponent_def_rank: null, // Actuals don't have this
      });
    }

    // Add filler projections for PAST weeks (only where there is no actual record)
    // Prefer Sleeper, fall back to ESPN
    const allPastProjections = [...allPastSleeperProjections, ...allPastEspnProjections];
    const pastProjByKey = new Map<string, any>();
    
    for (const proj of allPastProjections) {
      const normalizedName = normalizeName(proj.player_name);
      const key = `${normalizedName}:${proj.position}-${proj.week}-${proj.season}`;
      
      // Prefer Sleeper projections (they come first in the array)
      if (!pastProjByKey.has(key)) {
        pastProjByKey.set(key, proj);
      }
    }

    for (const [key, proj] of pastProjByKey.entries()) {
      if (poolMap.has(key)) continue; // already have an actual

      const normalizedTeam = normalizeTeam(proj.team);
      let opponent = proj.opponent;

      // If opponent is null, check if it's a bye week
      if (!opponent) {
        const hasGame = teamWeeksWithGames.has(`${normalizedTeam}-${proj.week}`);
        if (!hasGame) {
          opponent = 'BYE';
        }
      }

      // Create a DNP row to complete the player's week history
      poolMap.set(key, {
        player_id: proj.player_id,
        player_name: proj.player_name,
        position: proj.position,
        team: normalizedTeam,
        week: proj.week,
        season: proj.season,
        points_ppr: 0, // DNP weeks should not add points
        is_actual: true, // treat as past week placeholder
        did_not_play: true,
        passing_yards: 0,
        passing_tds: 0,
        passing_ints: 0,
        rushing_yards: 0,
        rushing_tds: 0,
        receptions: 0,
        receiving_yards: 0,
        receiving_tds: 0,
        opponent: opponent,
        opponent_def_rank: proj.opponent_def_rank ?? null,
      });
    }

    // Add projections (CURRENT and FUTURE weeks) - used for ROS calculations only
    // Merge Sleeper and ESPN projections, preferring Sleeper when both exist
    const allFutureProjections = [...allSleeperProjections, ...allEspnProjections];
    const futureProjByKey = new Map<string, any>();
    
    for (const proj of allFutureProjections) {
      const normalizedName = normalizeName(proj.player_name);
      const key = `${normalizedName}:${proj.position}-${proj.week}-${proj.season}`;
      
      // Prefer Sleeper projections (they come first in the array)
      if (!futureProjByKey.has(key)) {
        futureProjByKey.set(key, proj);
      }
    }

    for (const [key, proj] of futureProjByKey.entries()) {
      const normalizedTeam = normalizeTeam(proj.team);
      let opponent = proj.opponent;

      // If opponent is null, check if it's a bye week
      if (!opponent) {
        const hasGame = teamWeeksWithGames.has(`${normalizedTeam}-${proj.week}`);
        if (!hasGame) {
          opponent = 'BYE';
        }
      }

      // Handle both Sleeper and ESPN projection formats
      const isSleeper = 'pts_ppr' in proj;
      const isEspn = 'stats' in proj;

      let points_ppr = 0;
      let passing_yards = 0;
      let passing_tds = 0;
      let passing_ints = 0;
      let rushing_yards = 0;
      let rushing_tds = 0;
      let receptions = 0;
      let receiving_yards = 0;
      let receiving_tds = 0;

      if (isSleeper) {
        points_ppr = proj.pts_ppr || 0;
        passing_yards = proj.pass_yd || 0;
        passing_tds = proj.pass_td || 0;
        passing_ints = proj.pass_int || 0;
        rushing_yards = proj.rush_yd || 0;
        rushing_tds = proj.rush_td || 0;
        receptions = proj.rec || 0;
        receiving_yards = proj.rec_yd || 0;
        receiving_tds = proj.rec_td || 0;
      } else if (isEspn) {
        // ESPN stores stats in a jsonb object
        const stats = proj.stats || {};
        points_ppr = proj.projected_fp || 0;
        passing_yards = stats.passing_yards || 0;
        passing_tds = stats.passing_tds || 0;
        passing_ints = stats.passing_ints || 0;
        rushing_yards = stats.rushing_yards || 0;
        rushing_tds = stats.rushing_tds || 0;
        receptions = stats.receptions || 0;
        receiving_yards = stats.receiving_yards || 0;
        receiving_tds = stats.receiving_tds || 0;
      }

      poolMap.set(key, {
        player_id: proj.player_id,
        player_name: proj.player_name,
        position: proj.position,
        team: normalizedTeam,
        week: proj.week,
        season: proj.season,
        points_ppr,
        is_actual: false,
        did_not_play: false,
        passing_yards,
        passing_tds,
        passing_ints,
        rushing_yards,
        rushing_tds,
        receptions,
        receiving_yards,
        receiving_tds,
        opponent: opponent,
        opponent_def_rank: proj.opponent_def_rank || null,
      });
    }

    // Convert Map to array for insertion
    const poolRecords = Array.from(poolMap.values());
    console.log(`Built ${poolRecords.length} unique player pool records`);

    // Clear existing data for this season
    await supabase
      .from('player_pool')
      .delete()
      .eq('season', season);

    // Insert in chunks to avoid timeouts
    const chunkSize = 500;
    let insertedCount = 0;
    
    for (let i = 0; i < poolRecords.length; i += chunkSize) {
      const chunk = poolRecords.slice(i, i + chunkSize);
      const { error: insertError } = await supabase
        .from('player_pool')
        .insert(chunk);

      if (insertError) {
        console.error(`Chunk ${Math.floor(i / chunkSize) + 1} error:`, insertError);
        throw insertError;
      }
      insertedCount += chunk.length;
      console.log(`Inserted chunk ${Math.floor(i / chunkSize) + 1} (${insertedCount} total)`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        recordsInserted: insertedCount,
        season,
        currentWeek,
        message: 'Player pool computed and saved',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error computing player pool:', error);
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
