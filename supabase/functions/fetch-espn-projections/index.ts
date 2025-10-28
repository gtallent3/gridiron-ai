import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
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

      const leagueUrl = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${currentSeason}/segments/0/leagues/${league.league_id}?scoringPeriodId=${week}&view=kona_player_info`;
      
      const response = await fetch(leagueUrl, {
        headers: {
          'Cookie': `SWID=${swidCookie}; espn_s2=${espn_s2}`,
          'X-Fantasy-Filter': JSON.stringify(fantasyFilter),
        },
      });

      if (!response.ok) {
        console.error(`Failed to fetch week ${week}: ${response.status}`);
        continue;
      }

      const weekData = await response.json();
      const projectionStatsToInsert: any[] = [];
      const poolRows: any[] = [];

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

      const waiverUrl = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${currentSeason}/segments/0/leagues/${league.league_id}?scoringPeriodId=${week}&view=kona_player_info`;
      
      const waiverResponse = await fetch(waiverUrl, {
        headers: {
          'Cookie': `SWID=${swidCookie}; espn_s2=${espn_s2}`,
          'X-Fantasy-Filter': JSON.stringify(waiverFilter),
        },
      });

      let waiverPlayers: any[] = [];
      if (waiverResponse.ok) {
        const waiverData = await waiverResponse.json();
        waiverPlayers = waiverData.players || [];
        console.log(`Week ${week}: Found ${waiverPlayers.length} waiver/FA players`);
      }

      // Process rostered players
      for (const team of weekData.teams || []) {
        for (const entry of team.roster?.entries || []) {
          const player = entry.playerPoolEntry?.player;
          if (!player) continue;

          const espnId = entry.playerId?.toString();
          const normalizedPlayer = espnId ? normalizedMap.get(espnId) : null;

          const weekProjection = player.stats?.find((stat: any) =>
            stat.statSourceId === 1 && stat.statSplitTypeId === 1 && stat.scoringPeriodId === week
          );

          // Always add to player pool regardless of projection
          if (espnId) {
            poolRows.push({
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
            });
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

        const weekProjection = player.stats?.find((stat: any) =>
          stat.statSourceId === 1 && stat.scoringPeriodId === week && stat.seasonId === currentSeason
        );

        // Always add to player pool regardless of projection
        if (espnId) {
          poolRows.push({
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
          });
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
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Fetched projections for weeks ${startWeek}-${endWeek}`,
        projections_inserted: totalProjectionsInserted
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
