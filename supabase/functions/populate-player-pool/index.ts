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

    // Parse optional controls from request body
    let reset = false;
    let maxBatches = 20; // process ~20k rows per invocation by default to avoid timeouts
    let startSleeperId: string | null = null;
    let startNflId: string | null = null;
    try {
      const body = await req.json();
      reset = !!body?.reset;
      if (typeof body?.maxBatches === 'number' && body.maxBatches > 0) {
        maxBatches = body.maxBatches;
      }
      if (typeof body?.startSleeperId === 'string') startSleeperId = body.startSleeperId;
      if (typeof body?.startNflId === 'string') startNflId = body.startNflId;
    } catch (_) {
      // no body provided, use defaults
    }

    console.log(`Populating player pool for season ${season}...`, { reset, maxBatches, startSleeperId, startNflId });

    // Only clear existing data when explicitly requested (prevents losing progress on resumable runs)
    if (reset) {
      await supabase
        .from('player_pool_v2')
        .delete()
        .eq('season', season);
      console.log('Cleared existing player_pool_v2 rows for season', season);
    }

    // Fetch all canonical players
    const { data: canonicalPlayers, error: canonicalError } = await supabase
      .from('canonical_players')
      .select('id, sleeper_id, nfl_id, player_name, position');

    if (canonicalError) throw canonicalError;

    // Build lookup maps with player names
    const sleeperIdMap = new Map<string, { id: string, player_name: string }>();
    const nflIdMap = new Map<string, { id: string, player_name: string }>();
    
    for (const player of canonicalPlayers || []) {
      if (player.sleeper_id) {
        sleeperIdMap.set(player.sleeper_id, { id: player.id, player_name: player.player_name });
      }
      if (player.nfl_id) {
        nflIdMap.set(player.nfl_id, { id: player.id, player_name: player.player_name });
      }
    }

    console.log(`Loaded ${canonicalPlayers?.length || 0} canonical players`);

    let sleeperInserted = 0;
    let nflInserted = 0;

    // Process Sleeper projections in batches (keyset pagination)
    let lastSleeperId: string | null = startSleeperId;
    const pageSize = 1000;
    let sleeperBatches = 0;
    
    while (true) {
      let query = supabase
        .from('sleeper_projections')
        .select('*')
        .eq('season', season)
        .not('player_id', 'is', null)
        .order('id', { ascending: true })
        .limit(pageSize);

      if (lastSleeperId) {
        // Keyset pagination to avoid skipped/duplicated rows during concurrent writes
        // @ts-ignore - Supabase JS typing allows filter chaining
        query = query.gt('id', lastSleeperId);
      }

      const { data: projections, error: projError } = await query;

      if (projError) throw projError;
      if (!projections || projections.length === 0) break;

      const poolRecords = [];
      
      for (const proj of projections) {
        const canonical = sleeperIdMap.get(proj.player_id);
        if (!canonical) {
          console.warn(`No canonical player for Sleeper ID: ${proj.player_id} (${proj.player_name})`);
          continue;
        }

        poolRecords.push({
          canonical_player_id: canonical.id,
          player_name: canonical.player_name,
          source: 'sleeper_projection',
          season: proj.season,
          week: proj.week,
          team: proj.team,
          position: proj.position,
          projected_fp: proj.pts_ppr,
          passing_yards: proj.pass_yd,
          passing_tds: proj.pass_td,
          passing_ints: proj.pass_int,
          rushing_yards: proj.rush_yd,
          rushing_tds: proj.rush_td,
          receptions: proj.rec,
          receiving_yards: proj.rec_yd,
          receiving_tds: proj.rec_td,
          opponent: proj.opponent,
          opponent_def_rank: proj.opponent_def_rank,
          ros_sos_rank: proj.ros_sos_rank,
          playoff_sos_rank: proj.playoff_sos_rank,
          bye_week: proj.bye_week || false,
          raw_source_ids: { sleeper_id: proj.player_id }
        });
      }

      if (poolRecords.length > 0) {
        const { error: insertError } = await supabase
          .from('player_pool_v2')
          .upsert(poolRecords, { 
            onConflict: 'canonical_player_id,season,week,source',
            ignoreDuplicates: false 
          });

        if (insertError) {
          console.error('Sleeper insert error:', insertError);
          throw insertError; // Stop if there's an error
        }
        sleeperInserted += poolRecords.length;
      }

      lastSleeperId = projections[projections.length - 1].id;
      
      console.log(`Processed batch: fetched ${projections.length} projections, matched ${poolRecords.length} records, inserted ${sleeperInserted} total, last ID: ${lastSleeperId}`);
      
      sleeperBatches++;
      if (sleeperBatches >= maxBatches) {
        console.log(`Reached maxBatches (${maxBatches}) for sleeper_projections; nextSleeperId=${lastSleeperId}`);
        break;
      }
      
      if (projections.length < pageSize) break;
    }

    console.log(`Inserted ${sleeperInserted} Sleeper projection records`);

    // Process NFL actual stats in batches (keyset pagination)
    let lastNflId: string | null = startNflId;
    let nflBatches = 0;
    
    while (true) {
      let nflQuery = supabase
        .from('nfl_fantasy_points')
        .select('*')
        .eq('season', season)
        .not('player_id', 'is', null)
        .order('id', { ascending: true })
        .limit(pageSize);

      if (lastNflId) {
        // @ts-ignore - chaining filter
        nflQuery = nflQuery.gt('id', lastNflId);
      }

      const { data: actuals, error: actualsError } = await nflQuery;

      if (actualsError) throw actualsError;
      if (!actuals || actuals.length === 0) break;

      const poolRecords = [];
      
      for (const actual of actuals) {
        const canonical = nflIdMap.get(actual.player_id);
        if (!canonical) {
          console.warn(`No canonical player for NFL ID: ${actual.player_id} (${actual.player_name})`);
          continue;
        }

        poolRecords.push({
          canonical_player_id: canonical.id,
          player_name: canonical.player_name,
          source: 'nfl_actual',
          season: actual.season,
          week: actual.week,
          team: actual.team,
          position: actual.position,
          actual_fp: actual.fantasy_points_ppr,
          passing_yards: actual.passing_yards,
          passing_tds: actual.passing_tds,
          passing_ints: actual.passing_ints,
          rushing_yards: actual.rushing_yards,
          rushing_tds: actual.rushing_tds,
          receptions: actual.receptions,
          receiving_yards: actual.receiving_yards,
          receiving_tds: actual.receiving_tds,
          opponent: actual.opponent,
          raw_source_ids: { nfl_id: actual.player_id }
        });
      }

      if (poolRecords.length > 0) {
        const { error: insertError } = await supabase
          .from('player_pool_v2')
          .upsert(poolRecords, { 
            onConflict: 'canonical_player_id,season,week,source',
            ignoreDuplicates: false 
          });

        if (insertError) {
          console.error('NFL insert error:', insertError);
          throw insertError; // Stop if there's an error
        }
        nflInserted += poolRecords.length;
      }

      lastNflId = actuals[actuals.length - 1].id;
      
      console.log(`Processed NFL batch: fetched ${actuals.length} actuals, matched ${poolRecords.length} records, inserted ${nflInserted} total, last ID: ${lastNflId}`);
      
      nflBatches++;
      if (nflBatches >= maxBatches) {
        console.log(`Reached maxBatches (${maxBatches}) for nfl_actual; nextNflId=${lastNflId}`);
        break;
      }
      
      if (actuals.length < pageSize) break;
    }

    console.log(`Inserted ${nflInserted} NFL actual records`);

    return new Response(
      JSON.stringify({
        success: true,
        sleeperInserted,
        nflInserted,
        nextSleeperId: lastSleeperId,
        nextNflId: lastNflId,
        sleeperBatches,
        nflBatches,
        hasMoreSleeper: sleeperInserted > 0 && sleeperBatches >= maxBatches,
        hasMoreNfl: nflInserted > 0 && nflBatches >= maxBatches,
        message: 'Player pool populated successfully (resumable)'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error populating player pool:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
