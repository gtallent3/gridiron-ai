import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";
import { getTeamAbbreviation, mapPosition, processPlayerStats } from "./helpers.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Authentication required');

    const token = authHeader.replace('Bearer ', '');
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser(token);
    if (authError || !user) throw new Error('Authentication required');

    const { leagueId, startWeek, endWeek } = await req.json();
    if (!leagueId || !startWeek || !endWeek) {
      throw new Error('leagueId, startWeek, and endWeek are required');
    }
    if (startWeek < 1 || endWeek > 18 || startWeek > endWeek) {
      throw new Error('Invalid week range (must be 1-18)');
    }

    console.log(`Fetching ESPN projections for league ${leagueId}, weeks ${startWeek}-${endWeek}`);

    // Support both DB row id (uuid) and ESPN league_id (text)
    let { data: league, error: leagueError } = await supabase
      .from('connected_leagues')
      .select('id, league_id, platform')
      .eq('id', leagueId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!league) {
      const byLeagueId = await supabase
        .from('connected_leagues')
        .select('id, league_id, platform')
        .eq('league_id', leagueId)
        .eq('user_id', user.id)
        .maybeSingle();
      league = byLeagueId.data as any;
      leagueError = byLeagueId.error as any;
    }

    if (leagueError || !league) throw new Error('League not found');
    if (league.platform !== 'espn') throw new Error('This function only supports ESPN leagues');

    const { data: credentials, error: credError } = await supabaseUser.rpc('get_league_credentials', {
      p_user_id: user.id,
      p_platform: 'espn',
      p_league_id: league.league_id
    });

    if (credError || !credentials) throw new Error('Unable to retrieve stored credentials');

    const { espn_s2, swid } = credentials;
    const now = new Date();
    const currentSeason = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;

    const { data: normPlayers } = await supabase
      .from('normalized_players')
      .select('espn_id, player_id, player_name, position, team');

    const normalizedMap = new Map<string, any>();
    if (normPlayers) {
      for (const p of normPlayers) {
        if (p.espn_id) normalizedMap.set(p.espn_id, p);
      }
    }

    let totalProjectionsInserted = 0;
    let totalDSTInserted = 0;

    for (let week = startWeek; week <= endWeek; week++) {
      console.log(`Fetching projections for week ${week}...`);

      const swidCookie = swid?.startsWith('{') ? swid : `{${swid}}`;
      
      const fantasyFilter = {
        players: {
          filterStatsForExternalIds: { value: [currentSeason] },
          filterStatsForSourceIds: { value: [1] },
          filterStatsForTopScoringPeriodIds: { value: 2, additionalValue: [week] },
          limit: 2000
        }
      };

      const rosterUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${currentSeason}/segments/0/leagues/${league.league_id}?scoringPeriodId=${week}&view=mRoster`;
      const playersUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${currentSeason}/segments/0/leagues/${league.league_id}?scoringPeriodId=${week}&view=kona_player_info`;

      // 1) Fetch rosters (mRoster) WITHOUT X-Fantasy-Filter to avoid ESPN 400 errors
      const rosterResponse = await fetch(rosterUrl, {
        headers: {
          'Cookie': `SWID=${swidCookie}; espn_s2=${espn_s2}`,
        },
      });
      if (!rosterResponse.ok) {
        console.error(`Failed to fetch roster for week ${week}: ${rosterResponse.status}`);
        continue;
      }
      const rosterCT = rosterResponse.headers.get('content-type') || '';
      const rosterRaw = await rosterResponse.text();
      if (!rosterCT.includes('application/json') || rosterRaw.trim().startsWith('<')) {
        console.error(`Week ${week}: Non-JSON roster response from ESPN (status ${rosterResponse.status})`);
        continue;
      }
      const weekData = JSON.parse(rosterRaw);

      // 2) Fetch player info + stats (kona_player_info) WITH X-Fantasy-Filter
      const playersResponse = await fetch(playersUrl, {
        headers: {
          'Cookie': `SWID=${swidCookie}; espn_s2=${espn_s2}`,
          'X-Fantasy-Filter': JSON.stringify(fantasyFilter),
        },
      });
      let playersById = new Map<string, any>();
      if (playersResponse.ok) {
        const pct = playersResponse.headers.get('content-type') || '';
        const praw = await playersResponse.text();
        if (pct.includes('application/json') && !praw.trim().startsWith('<')) {
          const pdata = JSON.parse(praw);
          const allPlayers: any[] = pdata.players || [];
          for (const pl of allPlayers) {
            if (pl?.id != null) playersById.set(String(pl.id), pl);
          }
          console.log(`Week ${week}: Loaded ${playersById.size} players with stats context`);
        } else {
          console.error(`Week ${week}: Non-JSON players response from ESPN (status ${playersResponse.status})`);
        }
      } else {
        console.error(`Failed to fetch players for week ${week}: ${playersResponse.status}`);
      }
      const projectionStatsToInsert: any[] = [];
      const poolRows: any[] = [];
      const waiverRows: any[] = [];

      // Fetch waiver players
      const waiverFilter = {
        players: {
          filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
          filterStatsForExternalIds: { value: [currentSeason] },
          filterStatsForSourceIds: { value: [1] },
          filterStatsForTopScoringPeriodIds: { value: 2, additionalValue: [week] },
          limit: 2000,
          sortPercOwned: { sortPriority: 1, sortAsc: false }
        }
      };

       const waiverUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${currentSeason}/segments/0/leagues/${league.league_id}?scoringPeriodId=${week}&view=kona_player_info`;
      
      const waiverResponse = await fetch(waiverUrl, {
        headers: {
          'Cookie': `SWID=${swidCookie}; espn_s2=${espn_s2}`,
          'X-Fantasy-Filter': JSON.stringify(waiverFilter),
        },
      });

      let waiverPlayers: any[] = [];
      if (waiverResponse.ok) {
        const wct = waiverResponse.headers.get('content-type') || '';
        const wraw = await waiverResponse.text();
        if (wct.includes('application/json') && !wraw.trim().startsWith('<')) {
          const waiverData = JSON.parse(wraw);
          waiverPlayers = waiverData.players || [];
          console.log(`Week ${week}: Found ${waiverPlayers.length} waiver/FA players`);
        } else {
          console.error(`Week ${week}: Non-JSON waiver response from ESPN (status ${waiverResponse.status})`);
        }
      }

      // Process rostered players
      for (const team of weekData.teams || []) {
        for (const entry of team.roster?.entries || []) {
          const player = entry.playerPoolEntry?.player;
          if (!player) continue;

          const espnId = entry.playerId?.toString();
          const normalizedPlayer = espnId ? normalizedMap.get(espnId) : null;

          const playerInfo = playersById.get(espnId);
          const projCandidates = (playerInfo?.stats || []).filter((stat: any) =>
            stat.statSourceId === 1 && stat.statSplitTypeId === 2
          );
          const weekProjection = projCandidates.find((stat: any) => stat.scoringPeriodId === week) || projCandidates[0];

          const position = normalizedPlayer?.position || mapPosition(player.defaultPositionId);
          const teamAbbrev = normalizedPlayer?.team || (player.proTeamId ? getTeamAbbreviation(player.proTeamId) : null);
          const playerName = position === 'DST' 
            ? `${teamAbbrev} D/ST` 
            : (normalizedPlayer?.player_name || player.fullName || 'Unknown');
          
          // Debug logging for D/ST detection
          if (player.defaultPositionId === 16 || position === 'DST') {
            console.log(`[D/ST FOUND] name=${playerName}, position=${position}, defaultPosId=${player.defaultPositionId}, espnId=${espnId}, hasProjection=${!!weekProjection}, projCandidates=${projCandidates.length}`);
          }

          // Get or create canonical player (including D/ST)
          let canonicalId = null;
          if (position === 'DST' && espnId) {
            console.log(`Creating/finding D/ST canonical: ${playerName}, espnId=${espnId}`);
            let { data: canonicalDST, error: queryError } = await supabase
              .from('canonical_players')
              .select('id')
              .eq('espn_id', espnId)
              .eq('position', 'DST')
              .maybeSingle();

            if (queryError) console.error(`Error querying D/ST canonical:`, queryError);

            if (!canonicalDST) {
              console.log(`Inserting new D/ST canonical: ${playerName}`);
              const { data: newDST, error: insertError } = await supabase
                .from('canonical_players')
                .insert({
                  espn_id: espnId,
                  player_name: playerName,
                  position: 'DST',
                  team: teamAbbrev
                })
                .select('id')
                .single();
              
              if (insertError) {
                console.error(`ERROR inserting D/ST canonical:`, insertError);
              } else {
                console.log(`Successfully created D/ST canonical id=${newDST?.id}`);
              }
              canonicalDST = newDST;
            } else {
              console.log(`Found existing D/ST canonical id=${canonicalDST.id}`);
            }
            canonicalId = canonicalDST?.id;
          }

          // Add to player_pool_v2 for D/ST (even if no projections available)
          if (espnId && position === 'DST' && canonicalId) {
            console.log(`Upserting D/ST to player_pool_v2: ${playerName}, canonicalId=${canonicalId}, hasProjection=${!!weekProjection}`);
            const rawStats = weekProjection?.stats || {};
            const { error: poolError } = await supabase.from('player_pool_v2').upsert({
              canonical_player_id: canonicalId,
              player_name: playerName,
              position: 'DST',
              team: teamAbbrev,
              season: currentSeason,
              week,
              source: 'composite',
              projected_fp: typeof weekProjection?.appliedTotal === 'number' ? weekProjection.appliedTotal : null,
              passing_yards: rawStats ? (parseFloat(rawStats['95']) || null) : null, // INTs
              passing_tds: rawStats ? (parseFloat(rawStats['99']) || null) : null, // sacks
              rushing_yards: rawStats ? (parseFloat(rawStats['96']) || null) : null, // fumbles recovered
              rushing_tds: rawStats ? (parseFloat(rawStats['103']) || null) : null, // INT TDs
              receiving_yards: rawStats ? (parseFloat(rawStats['104']) || null) : null, // fumble TDs
              receiving_tds: rawStats ? (parseFloat(rawStats['98']) || null) : null, // safeties
              receptions: rawStats ? (parseFloat(rawStats['97']) || null) : null, // blocked kicks
              raw_source_ids: { espn: espnId },
              bye_week: false,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'canonical_player_id,season,week,source',
              ignoreDuplicates: false
            });
            
            if (poolError) {
              console.error(`ERROR upserting D/ST to player_pool_v2:`, poolError);
            } else {
              console.log(`Successfully upserted D/ST to player_pool_v2: ${playerName}`);
            }
            totalDSTInserted++;
          }

          // Add to player pool with projection data (existing logic for non-DST)
          if (espnId && position !== 'DST') {
            const poolEntry: any = {
              league_id: league.id,
              espn_league_id: league.league_id,
              player_id: normalizedPlayer?.player_id || `espn_${espnId}`,
              player_name: normalizedPlayer?.player_name || player.fullName || 'Unknown',
              position: normalizedPlayer?.position || mapPosition(player.defaultPositionId),
              team: normalizedPlayer?.team || (player.proTeamId ? getTeamAbbreviation(player.proTeamId) : null),
              season: currentSeason,
              week,
              is_owned: true,
              waiver_status: 'ROSTERED',
              percent_owned: 100,
              percent_started: 0,
              provider_ids: { espn: espnId },
              updated_at: new Date().toISOString(),
            };

            // Add projection stats if available
            if (weekProjection?.stats || weekProjection?.appliedStats) {
              const projectedPts = typeof weekProjection?.appliedTotal === 'number'
                ? weekProjection.appliedTotal
                : weekProjection?.appliedStats
                  ? Object.values(weekProjection.appliedStats).reduce((sum: number, v: any) => sum + (typeof v === 'number' ? v : 0), 0)
                  : 0;
              poolEntry.stats = weekProjection.stats || {};
              poolEntry.applied_breakdown = weekProjection.appliedStats || {};
              poolEntry.projected_fp = projectedPts;
              poolEntry.confidence = 0.8;
              poolEntry.source = 'espn_projection';
            }

            poolRows.push(poolEntry);
          }

          if (weekProjection?.stats || weekProjection?.appliedStats) {
            const projectionEntry = processPlayerStats(
              player, weekProjection, normalizedPlayer, week, currentSeason, espnId, 'ROSTERED', {}
            );
            projectionStatsToInsert.push(projectionEntry);
            
            if (!normalizedPlayer && espnId) {
              const newPlayer = {
                player_id: `espn_${espnId}`,
                espn_id: espnId,
                player_name: player.fullName || 'Unknown',
                position: mapPosition(player.defaultPositionId),
                team: player.proTeamId ? getTeamAbbreviation(player.proTeamId) : 'FA',
              };
              normalizedMap.set(espnId, newPlayer);
              await supabase.from('normalized_players').upsert([newPlayer], { onConflict: 'player_id', ignoreDuplicates: true });
            }
          }
        }
      }

      // Process waiver players
      for (const playerData of waiverPlayers) {
        const player = playerData.player;
        if (!player) continue;

        const espnId = player.id?.toString();
        const normalizedPlayer = espnId ? normalizedMap.get(espnId) : null;

        if (projectionStatsToInsert.some(p => p.provider_ids?.espn === espnId)) continue;

        const ownership = playerData.ownership || {};
        const waiverStatus = playerData.status === 'FREEAGENT' ? 'FREEAGENT' : 'WAIVERS';

        const projCandidates = (player.stats || []).filter((stat: any) =>
          stat.statSourceId === 1 && stat.statSplitTypeId === 2
        );
        const weekProjection = projCandidates.find((stat: any) => stat.scoringPeriodId === week) || projCandidates[0];

        const position = normalizedPlayer?.position || mapPosition(player.defaultPositionId);
        const teamAbbrev = normalizedPlayer?.team || (player.proTeamId ? getTeamAbbreviation(player.proTeamId) : null);
        const playerName = position === 'DST' 
          ? `${teamAbbrev} D/ST` 
          : (normalizedPlayer?.player_name || player.fullName || 'Unknown');

        // Get or create canonical player for D/ST on waivers
        let canonicalId = null;
        if (position === 'DST' && espnId) {
          let { data: canonicalDST } = await supabase
            .from('canonical_players')
            .select('id')
            .eq('espn_id', espnId)
            .eq('position', 'DST')
            .maybeSingle();

          if (!canonicalDST) {
            const { data: newDST } = await supabase
              .from('canonical_players')
              .insert({
                espn_id: espnId,
                player_name: playerName,
                position: 'DST',
                team: teamAbbrev
              })
              .select('id')
              .single();
            canonicalDST = newDST;
          }
          canonicalId = canonicalDST?.id;
        }

        // Add D/ST to player_pool_v2 (even if no projections available)
        if (espnId && position === 'DST' && canonicalId) {
          const rawStats = weekProjection?.stats || {};
          await supabase.from('player_pool_v2').upsert({
            canonical_player_id: canonicalId,
            player_name: playerName,
            position: 'DST',
            team: teamAbbrev,
            season: currentSeason,
            week,
            source: 'composite',
            projected_fp: typeof weekProjection?.appliedTotal === 'number' ? weekProjection.appliedTotal : null,
            passing_yards: rawStats ? (parseFloat(rawStats['95']) || null) : null,
            passing_tds: rawStats ? (parseFloat(rawStats['99']) || null) : null,
            rushing_yards: rawStats ? (parseFloat(rawStats['96']) || null) : null,
            rushing_tds: rawStats ? (parseFloat(rawStats['103']) || null) : null,
            receiving_yards: rawStats ? (parseFloat(rawStats['104']) || null) : null,
            receiving_tds: rawStats ? (parseFloat(rawStats['98']) || null) : null,
            receptions: rawStats ? (parseFloat(rawStats['97']) || null) : null,
            raw_source_ids: { espn: espnId },
            bye_week: false,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'canonical_player_id,season,week,source',
            ignoreDuplicates: false
          });
          totalDSTInserted++;
        }

        // Add to player pool with projection data (non-DST)
        if (espnId && position !== 'DST') {
          const poolEntry: any = {
            league_id: league.id,
            espn_league_id: league.league_id,
            player_id: normalizedPlayer?.player_id || `espn_${espnId}`,
            player_name: normalizedPlayer?.player_name || player.fullName || 'Unknown',
            position: normalizedPlayer?.position || mapPosition(player.defaultPositionId),
            team: normalizedPlayer?.team || (player.proTeamId ? getTeamAbbreviation(player.proTeamId) : null),
            season: currentSeason,
            week,
            is_owned: false,
            waiver_status: waiverStatus,
            percent_owned: ownership.percentOwned || 0,
            percent_started: ownership.percentStarted || 0,
            provider_ids: { espn: espnId },
            updated_at: new Date().toISOString(),
          };

          // Add projection stats if available
          if (weekProjection?.stats || weekProjection?.appliedStats) {
            const projectedPts = typeof weekProjection?.appliedTotal === 'number'
              ? weekProjection.appliedTotal
              : weekProjection?.appliedStats
                ? Object.values(weekProjection.appliedStats).reduce((sum: number, v: any) => sum + (typeof v === 'number' ? v : 0), 0)
                : 0;
            poolEntry.stats = weekProjection.stats || {};
            poolEntry.applied_breakdown = weekProjection.appliedStats || {};
            poolEntry.projected_fp = projectedPts;
            poolEntry.confidence = 0.8;
            poolEntry.source = 'espn_projection';
          }

          poolRows.push(poolEntry);

          // Note: waiver_wire_players table was removed - data stored in projected_player_stats
        }

        if (weekProjection?.stats || weekProjection?.appliedStats) {
          const projectionEntry = processPlayerStats(
            player, weekProjection, normalizedPlayer, week, currentSeason, espnId, waiverStatus, ownership
          );
          projectionStatsToInsert.push(projectionEntry);
          
          if (!normalizedPlayer && espnId) {
            const newPlayer = {
              player_id: `espn_${espnId}`,
              espn_id: espnId,
              player_name: player.fullName || 'Unknown',
              position: mapPosition(player.defaultPositionId),
              team: player.proTeamId ? getTeamAbbreviation(player.proTeamId) : 'FA',
            };
            normalizedMap.set(espnId, newPlayer);
            await supabase.from('normalized_players').upsert([newPlayer], { onConflict: 'player_id', ignoreDuplicates: true });
          }
        }
      }

      if (projectionStatsToInsert.length > 0) {
        await supabase.from('projected_player_stats').upsert(projectionStatsToInsert, {
          onConflict: 'player_id,season,week,source',
          ignoreDuplicates: false
        });
        console.log(`Inserted ${projectionStatsToInsert.length} projections for week ${week}`);
        totalProjectionsInserted += projectionStatsToInsert.length;
      }

      if (poolRows.length > 0) {
        await supabase.from('player_pool').upsert(poolRows, {
          onConflict: 'league_id,player_id,season,week',
          ignoreDuplicates: false
        });
        console.log(`Inserted ${poolRows.length} players into pool for week ${week}`);
      }

      if (waiverRows.length > 0) {
        await supabase.from('waiver_wire_players').upsert(waiverRows, {
          onConflict: 'league_id,season,week,player_id',
          ignoreDuplicates: false
        });
        console.log(`Inserted ${waiverRows.length} waiver players for week ${week}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Fetched projections for weeks ${startWeek}-${endWeek}`,
        projections_inserted: totalProjectionsInserted,
        dst_inserted: totalDSTInserted
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Projection fetch error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
