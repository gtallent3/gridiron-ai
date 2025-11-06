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

    // Fetch projections for current and future weeks (fetch all records with range)
    let allProjections: any[] = [];
    let projectionsPage = 0;
    
    while (true) {
      const { data: projections, error: projError } = await supabase
        .from('sleeper_projections')
        .select('*')
        .eq('season', season)
        .gte('week', currentWeek)
        .in('position', ['QB', 'RB', 'WR', 'TE'])
        .not('team', 'is', null)
        .range(projectionsPage * pageSize, (projectionsPage + 1) * pageSize - 1);

      if (projError) throw projError;
      if (!projections || projections.length === 0) break;
      
      allProjections = allProjections.concat(projections);
      projectionsPage++;
      
      if (projections.length < pageSize) break;
    }

    console.log(`Fetched ${allActuals.length} actual records and ${allProjections.length} projection records`);

    // Build player pool records
    const poolRecords = [];

    // Add actual stats (past weeks)
    for (const actual of allActuals) {
      poolRecords.push({
        player_id: actual.player_id,
        player_name: actual.player_name,
        position: actual.position,
        team: normalizeTeam(actual.team),
        week: actual.week,
        season: actual.season,
        points_ppr: actual.fantasy_points_ppr || 0,
        is_actual: true,
        passing_yards: actual.passing_yards || 0,
        passing_tds: actual.passing_tds || 0,
        passing_ints: actual.passing_ints || 0,
        rushing_yards: actual.rushing_yards || 0,
        rushing_tds: actual.rushing_tds || 0,
        receptions: actual.receptions || 0,
        receiving_yards: actual.receiving_yards || 0,
        receiving_tds: actual.receiving_tds || 0,
        opponent: actual.opponent,
        opponent_def_rank: null, // Actuals don't have this
      });
    }

    // Add projections (current and future weeks)
    for (const proj of allProjections) {
      poolRecords.push({
        player_id: proj.player_id,
        player_name: proj.player_name,
        position: proj.position,
        team: normalizeTeam(proj.team),
        week: proj.week,
        season: proj.season,
        points_ppr: proj.pts_ppr || 0,
        is_actual: false,
        passing_yards: proj.pass_yd || 0,
        passing_tds: proj.pass_td || 0,
        passing_ints: proj.pass_int || 0,
        rushing_yards: proj.rush_yd || 0,
        rushing_tds: proj.rush_td || 0,
        receptions: proj.rec || 0,
        receiving_yards: proj.rec_yd || 0,
        receiving_tds: proj.rec_td || 0,
        opponent: proj.opponent,
        opponent_def_rank: proj.opponent_def_rank,
      });
    }

    console.log(`Built ${poolRecords.length} player pool records`);

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
      const { error: upsertError } = await supabase
        .from('player_pool')
        .upsert(chunk, { onConflict: 'player_id,week,season', ignoreDuplicates: false });

      if (upsertError) {
        console.error(`Chunk ${Math.floor(i / chunkSize) + 1} error:`, upsertError);
        throw upsertError;
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
