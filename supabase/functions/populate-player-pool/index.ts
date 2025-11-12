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
    let maxBatches = 20; // number of chunks per invocation
    let startSleeperIndex = 0;
    let startNflIndex = 0;
    let chunkSize = 1000;
    try {
      const body = await req.json();
      reset = !!body?.reset;
      if (typeof body?.maxBatches === 'number' && body.maxBatches > 0) {
        maxBatches = body.maxBatches;
      }
      if (typeof body?.startSleeperIndex === 'number' && body.startSleeperIndex >= 0) {
        startSleeperIndex = body.startSleeperIndex;
      }
      if (typeof body?.startNflIndex === 'number' && body.startNflIndex >= 0) {
        startNflIndex = body.startNflIndex;
      }
      if (typeof body?.chunkSize === 'number' && body.chunkSize > 0 && body.chunkSize <= 5000) {
        chunkSize = body.chunkSize;
      }
    } catch (_) {
      // no body provided, use defaults
    }

    console.log(`Populating player pool for season ${season}...`, { reset, maxBatches, startSleeperIndex, startNflIndex, chunkSize });

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

    // Process Sleeper projections by mapped player IDs (chunked, resumable)
    const sleeperIds = Array.from(sleeperIdMap.keys());
    let nextSleeperIndex = startSleeperIndex;
    let sleeperChunksProcessed = 0;

    while (nextSleeperIndex < sleeperIds.length && sleeperChunksProcessed < maxBatches) {
      const idsChunk = sleeperIds.slice(nextSleeperIndex, nextSleeperIndex + chunkSize);

      const { data: projections, error: projError } = await supabase
        .from('sleeper_projections')
        .select('*')
        .eq('season', season)
        .in('player_id', idsChunk);

      if (projError) throw projError;

      const poolRecords: any[] = [];
      for (const proj of projections || []) {
        const canonical = sleeperIdMap.get(proj.player_id);
        if (!canonical) continue;
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
            ignoreDuplicates: false,
          });
        if (insertError) throw insertError;
        sleeperInserted += poolRecords.length;
      }

      console.log(`Sleeper chunk index ${nextSleeperIndex}-${nextSleeperIndex + idsChunk.length - 1}: upserted ${poolRecords.length}`);

      nextSleeperIndex += idsChunk.length;
      sleeperChunksProcessed += 1;
    }

    const hasMoreSleeper = nextSleeperIndex < sleeperIds.length;

    // Process NFL actual stats by mapped player IDs (chunked, resumable)
    const nflIds = Array.from(nflIdMap.keys());
    let nextNflIndex = startNflIndex;
    let nflChunksProcessed = 0;

    while (nextNflIndex < nflIds.length && nflChunksProcessed < maxBatches) {
      const idsChunk = nflIds.slice(nextNflIndex, nextNflIndex + chunkSize);

      const { data: actuals, error: actualsError } = await supabase
        .from('nfl_fantasy_points')
        .select('*')
        .eq('season', season)
        .in('player_id', idsChunk);

      if (actualsError) throw actualsError;

      const poolRecords: any[] = [];
      for (const actual of (actuals || [])) {
        const canonical = nflIdMap.get(actual.player_id);
        if (!canonical) continue;
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
            ignoreDuplicates: false,
          });
        if (insertError) throw insertError;
        nflInserted += poolRecords.length;
      }

      console.log(`NFL chunk index ${nextNflIndex}-${nextNflIndex + idsChunk.length - 1}: upserted ${poolRecords.length}`);

      nextNflIndex += idsChunk.length;
      nflChunksProcessed += 1;
    }

    const hasMoreNfl = nextNflIndex < nflIds.length;

    console.log(`Inserted ${nflInserted} NFL actual records`);

    return new Response(
      JSON.stringify({
        success: true,
        sleeperInserted,
        nflInserted,
        nextSleeperIndex,
        nextNflIndex,
        hasMoreSleeper,
        hasMoreNfl,
        message: 'Player pool populated successfully (resumable by indices)'
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
