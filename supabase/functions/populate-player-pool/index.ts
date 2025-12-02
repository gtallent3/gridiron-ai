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

    // Parse optional controls from request body
    let reset = false;
    let maxBatches = 2; // SMALL batches to prevent timeouts (2 chunks = ~1000 players max)
    let startSleeperIndex = 0;
    let startNflIndex = 0;
    let chunkSize = 500; // chunk size per batch
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

    // Fetch all canonical players with pagination to avoid 1k default limit
    const canonicalPlayers: Array<{ id: string; sleeper_id: string | null; nfl_id: string | null; player_name: string; position: string }> = [];
    const cpChunkSize = 1000;
    let cpFrom = 0;
    while (true) {
      const { data: batch, error: canonicalError } = await supabase
        .from('canonical_players')
        .select('id, sleeper_id, nfl_id, player_name, position')
        .range(cpFrom, cpFrom + cpChunkSize - 1);

      if (canonicalError) throw canonicalError;
      if (!batch || batch.length === 0) break;

      canonicalPlayers.push(...batch);
      cpFrom += batch.length;
      if (batch.length < cpChunkSize) break; // last page reached
    }

    // Build lookup maps with player names
    const sleeperIdMap = new Map<string, { id: string, player_name: string }>();
    const nflIdMap = new Map<string, { id: string, player_name: string }>();
    
    for (const player of canonicalPlayers) {
      if (player.sleeper_id) {
        sleeperIdMap.set(player.sleeper_id, { id: player.id, player_name: player.player_name });
      }
      if (player.nfl_id) {
        nflIdMap.set(player.nfl_id, { id: player.id, player_name: player.player_name });
      }
    }

    console.log(`Loaded ${canonicalPlayers.length} canonical players`);

    // Team abbreviation normalization mapping
    const normalizeTeam = (team: string | null | undefined): string | null => {
      if (!team) return null;
      const normalized: Record<string, string> = {
        'WSH': 'WAS',
        'TAM': 'TB',
        'LVR': 'LV',
        'NOR': 'NO',
        'SFO': 'SF',
        'NWE': 'NE',
        'GNB': 'GB',
        'KAN': 'KC',
        'LAR': 'LA'
      };
      return normalized[team] || team;
    };

    // Fetch defensive rankings for the season to enrich opponent_def_rank
    // Fetch ALL defensive rankings with pagination (default 1000 limit is too small)
    const defensiveRankings: any[] = [];
    let defFrom = 0;
    const defChunkSize = 1000;
    while (true) {
      const { data: batch, error: defError } = await supabase
        .from('defensive_rankings')
        .select('*')
        .eq('season', season)
        .range(defFrom, defFrom + defChunkSize - 1);
      
      if (defError) throw defError;
      if (!batch || batch.length === 0) break;
      
      defensiveRankings.push(...batch);
      defFrom += batch.length;
      if (batch.length < defChunkSize) break;
    }
    
    // Build lookup maps:
    // 1. Exact week match: "opponent_position_week" -> rank
    // 2. Season average: calculate avg points allowed per team/position, then rank 1-32
    const defRankMap = new Map<string, number>();
    const defRankAvgMap = new Map<string, number>();
    const avgPointsMap = new Map<string, { sum: number; count: number }>();
    
    (defensiveRankings || []).forEach((dr: any) => {
      // Normalize team names in defensive rankings data
      const normalizedTeam = normalizeTeam(dr.team);
      const weekKey = `${normalizedTeam}_${dr.position}_${dr.week}`;
      const avgKey = `${normalizedTeam}_${dr.position}`;
      
      defRankMap.set(weekKey, dr.rank);
      
      // Accumulate points allowed for season average calculation
      if (!avgPointsMap.has(avgKey)) {
        avgPointsMap.set(avgKey, { sum: 0, count: 0 });
      }
      const acc = avgPointsMap.get(avgKey)!;
      acc.sum += (dr.avg_points_allowed || 0);
      acc.count += 1;
    });
    
    // Calculate average points allowed per team/position, then rank 1-32 per position
    const positions = ['QB', 'RB', 'WR', 'TE'];
    for (const position of positions) {
      const teamAvgs: Array<{ team: string; avgPoints: number }> = [];
      
      avgPointsMap.forEach((acc, key) => {
        if (key.endsWith(`_${position}`)) {
          const team = key.replace(`_${position}`, '');
          teamAvgs.push({
            team,
            avgPoints: acc.sum / acc.count
          });
        }
      });
      
      // Debug TE specifically
      if (position === 'TE') {
        console.log(`TE: Found ${teamAvgs.length} teams with TE defensive data`);
        if (teamAvgs.length > 0) {
          console.log(`  Sample TE entries: ${teamAvgs.slice(0, 3).map(t => `${t.team}:${t.avgPoints.toFixed(2)}`).join(', ')}`);
        }
      }
      
      // Sort by avg points allowed: fewest = rank 1 (hardest), most = rank 32 (easiest)
      teamAvgs.sort((a, b) => a.avgPoints - b.avgPoints);
      
      // Assign unique ranks 1-32 (or fewer if less than 32 teams have data)
      teamAvgs.forEach((teamData, index) => {
        const avgKey = `${teamData.team}_${position}`;
        defRankAvgMap.set(avgKey, index + 1);
      });
      
      // Debug TE after ranking
      if (position === 'TE') {
        console.log(`TE: Added ${teamAvgs.length} entries to defRankAvgMap`);
        const wasTeRankAfterLoop = defRankAvgMap.get('WAS_TE');
        console.log(`  WAS_TE rank after loop: ${wasTeRankAfterLoop ?? 'NOT FOUND'}`);
      }
      
      // Debug log for WR position
      if (position === 'WR') {
        console.log(`WR Defense Rankings (1-32):`);
        teamAvgs.slice(0, 20).forEach((t, i) => {
          console.log(`  #${i+1}: ${t.team} (${t.avgPoints.toFixed(2)} pts allowed)`);
        });
      }
    }
    
    console.log(`Loaded ${defensiveRankings?.length || 0} defensive rankings with ${defRankAvgMap.size} normalized season-average ranks (1-32 per position)`);
    
    // Debug: Check if WAS_TE specifically exists
    const wasTeRank = defRankAvgMap.get('WAS_TE');
    console.log(`WAS_TE defensive rank in map: ${wasTeRank ?? 'NOT FOUND'}`);
    console.log(`Total TE entries in map: ${Array.from(defRankAvgMap.keys()).filter(k => k.endsWith('_TE')).length}`);

    // Fetch injury status data for the season
    const injuryData: Array<{ player_name: string; week: number; status: string | null; status_explanation: string | null }> = [];
    let injFrom = 0;
    const injChunkSize = 1000;
    while (true) {
      const { data: batch, error: injError } = await supabase
        .from('player_injury_status')
        .select('player_name, week, status, status_explanation')
        .eq('season', season)
        .range(injFrom, injFrom + injChunkSize - 1);
      
      if (injError) throw injError;
      if (!batch || batch.length === 0) break;
      
      injuryData.push(...batch);
      injFrom += batch.length;
      if (batch.length < injChunkSize) break;
    }
    
    // Build injury lookup map: "normalized_player_name_week" -> { status, explanation }
    const injuryMap = new Map<string, { status: string | null; explanation: string | null }>();
    const normalizePlayerName = (name: string): string => {
      return name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
    };
    
    // Name alias map: fantasy nickname -> legal name (as it appears in nflverse)
    // This handles cases where fantasy platforms use nicknames but injury data uses legal names
    const nameAliasMap: Record<string, string> = {
      'bucky irving': "mar'keise irving",
      'hollywood brown': 'marquise brown',
      'tank dell': 'nathaniel dell',
      'chig okonkwo': 'chigoziem okonkwo',
      'gabe davis': 'gabriel davis',
      'scotty miller': 'scott miller',
      'mike williams': 'michael williams',
      'robbie chosen': 'robbie anderson',
      'chosen anderson': 'robbie anderson',
    };
    
    // Resolve fantasy name to legal name for injury lookup
    const resolveInjuryName = (fantasyName: string): string => {
      const normalized = normalizePlayerName(fantasyName);
      const lowerName = fantasyName.toLowerCase().trim();
      return nameAliasMap[lowerName] ? normalizePlayerName(nameAliasMap[lowerName]) : normalized;
    };
    
    for (const inj of injuryData) {
      if (inj.player_name) {
        const key = `${normalizePlayerName(inj.player_name)}_${inj.week}`;
        injuryMap.set(key, { status: inj.status, explanation: inj.status_explanation });
      }
    }
    
    console.log(`Loaded ${injuryData.length} injury records, ${injuryMap.size} unique player-week entries`);

    let sleeperInserted = 0;
    let nflInserted = 0;

    // Process Sleeper projections by mapped player IDs (chunked, resumable)
    const sleeperIds = Array.from(sleeperIdMap.keys());
    let nextSleeperIndex = startSleeperIndex;
    let sleeperChunksProcessed = 0;

    while (nextSleeperIndex < sleeperIds.length && sleeperChunksProcessed < maxBatches) {
      const idsChunk = sleeperIds.slice(nextSleeperIndex, nextSleeperIndex + chunkSize);

      // Paginate through projections to avoid the 1000-row default limit
      let pageFrom = 0;
      const pageSize = 1000;
      let totalUpsertedForChunk = 0;
      while (true) {
        const { data: projections, error: projError } = await supabase
          .from('sleeper_projections')
          .select('*')
          .eq('season', season)
          .in('player_id', idsChunk)
          .not('player_name', 'is', null)
          .not('position', 'is', null)
          .order('player_id', { ascending: true })
          .order('week', { ascending: true })
          .range(pageFrom, pageFrom + pageSize - 1);

        if (projError) throw projError;
        if (!projections || projections.length === 0) break;

        const poolRecords: any[] = [];
        for (const proj of projections) {
          const canonical = sleeperIdMap.get(proj.player_id);
          if (!canonical) continue;
          
          // Skip players with null position (violates NOT NULL constraint)
          if (!proj.position) {
            console.log(`Skipping Sleeper player ${proj.player_name} (${proj.player_id}) - null position`);
            continue;
          }
          
          // Normalize opponent FIRST, then look up defensive rank
          const normalizedOpp = proj.opponent ? normalizeTeam(proj.opponent) : null;
          let defRank: number | null = null;
          if (normalizedOpp && proj.position) {
            // Always use season-average normalized rank (1-32) for consistency
            const avgKey = `${normalizedOpp}_${proj.position}`;
            defRank = defRankAvgMap.get(avgKey) ?? null;
          }
          
          // Look up injury status (use alias resolution for nickname -> legal name mapping)
          const injuryKey = `${resolveInjuryName(canonical.player_name)}_${proj.week}`;
          const injury = injuryMap.get(injuryKey);
          
          poolRecords.push({
            canonical_player_id: canonical.id,
            player_name: canonical.player_name,
            source: 'sleeper_projection',
            season: proj.season,
            week: proj.week,
            team: normalizeTeam(proj.team),
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
            opponent: normalizedOpp,
            opponent_def_rank: defRank,
            ros_sos_rank: proj.ros_sos_rank,
            playoff_sos_rank: proj.playoff_sos_rank,
            bye_week: proj.bye_week || false,
            raw_source_ids: { sleeper_id: proj.player_id },
            injury_status: injury?.status ?? null,
            injury_status_explanation: injury?.explanation ?? null
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
          totalUpsertedForChunk += poolRecords.length;
        }

        pageFrom += projections.length;
        if (projections.length < pageSize) break; // last page reached for this idsChunk
      }

      console.log(`Sleeper chunk index ${nextSleeperIndex}-${nextSleeperIndex + idsChunk.length - 1}: upserted ${totalUpsertedForChunk}`);

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

      // Paginate through actuals to avoid the 1000-row default limit
      let pageFrom = 0;
      const pageSize = 1000;
      let totalUpsertedForChunk = 0;
      while (true) {
        const { data: actuals, error: actualsError } = await supabase
          .from('nfl_fantasy_points')
          .select('*')
          .eq('season', season)
          .in('player_id', idsChunk)
          .not('player_name', 'is', null)
          .not('position', 'is', null)
          .order('player_id', { ascending: true })
          .order('week', { ascending: true })
          .range(pageFrom, pageFrom + pageSize - 1);

        if (actualsError) throw actualsError;
        if (!actuals || actuals.length === 0) break;

        const poolRecords: any[] = [];
        for (const actual of actuals) {
          const canonical = nflIdMap.get(actual.player_id);
          if (!canonical) continue;
          
          // Skip players with null position (violates NOT NULL constraint)
          if (!actual.position) {
            console.log(`Skipping NFL player ${actual.player_name} (${actual.player_id}) - null position`);
            continue;
          }
          
          // Normalize opponent FIRST, then look up defensive rank
          const normalizedOpp = actual.opponent ? normalizeTeam(actual.opponent) : null;
          let defRank: number | null = null;
          if (normalizedOpp && actual.position) {
            // Always use season-average normalized rank (1-32) for consistency
            const avgKey = `${normalizedOpp}_${actual.position}`;
            defRank = defRankAvgMap.get(avgKey) ?? null;
          }
          
          // Look up injury status (use alias resolution for nickname -> legal name mapping)
          const injuryKey = `${resolveInjuryName(canonical.player_name)}_${actual.week}`;
          const injury = injuryMap.get(injuryKey);
          
          poolRecords.push({
            canonical_player_id: canonical.id,
            player_name: canonical.player_name,
            source: 'nfl_actual',
            season: actual.season,
            week: actual.week,
            team: normalizeTeam(actual.team),
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
            opponent: normalizedOpp,
            opponent_def_rank: defRank,
            raw_source_ids: { nfl_id: actual.player_id },
            injury_status: injury?.status ?? null,
            injury_status_explanation: injury?.explanation ?? null
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
          totalUpsertedForChunk += poolRecords.length;
        }

        pageFrom += actuals.length;
        if (actuals.length < pageSize) break; // last page reached for this idsChunk
      }

      console.log(`NFL chunk index ${nextNflIndex}-${nextNflIndex + idsChunk.length - 1}: upserted ${totalUpsertedForChunk}`);

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
    const errorMessage = error instanceof Error ? error.message : String(error || 'Unknown error occurred');
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
