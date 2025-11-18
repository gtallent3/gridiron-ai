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

    console.log(`Fetched ${allActuals.length} actual, ${allPastSleeperProjections.length} past Sleeper projections, and ${allSleeperProjections.length} future Sleeper projections`);

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
    for (const proj of allPastSleeperProjections) {
      const normalizedName = normalizeName(proj.player_name);
      const key = `${normalizedName}:${proj.position}-${proj.week}-${proj.season}`;
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
    for (const proj of allSleeperProjections) {
      const normalizedName = normalizeName(proj.player_name);
      const key = `${normalizedName}:${proj.position}-${proj.week}-${proj.season}`;

      const normalizedTeam = normalizeTeam(proj.team);
      let opponent = proj.opponent;

      // If opponent is null, check if it's a bye week
      if (!opponent) {
        const hasGame = teamWeeksWithGames.has(`${normalizedTeam}-${proj.week}`);
        if (!hasGame) {
          opponent = 'BYE';
        }
      }

      poolMap.set(key, {
        player_id: proj.player_id,
        player_name: proj.player_name,
        position: proj.position,
        team: normalizedTeam,
        week: proj.week,
        season: proj.season,
        points_ppr: proj.pts_ppr || 0,
        is_actual: false,
        did_not_play: false,
        passing_yards: proj.pass_yd || 0,
        passing_tds: proj.pass_td || 0,
        passing_ints: proj.pass_int || 0,
        rushing_yards: proj.rush_yd || 0,
        rushing_tds: proj.rush_td || 0,
        receptions: proj.rec || 0,
        receiving_yards: proj.rec_yd || 0,
        receiving_tds: proj.rec_td || 0,
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
