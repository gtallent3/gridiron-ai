import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const getTeamAbbreviation = (teamId: number): string => {
  const teams: Record<number, string> = {
    1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET',
    9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN',
    17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC',
    25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU'
  };
  return teams[teamId] || 'FA';
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
    if (!authHeader) {
      throw new Error('Authentication required');
    }

    const token = authHeader.replace('Bearer ', '');
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser(token);
    if (authError || !user) {
      throw new Error('Authentication required');
    }

    const { leagueId, startWeek, endWeek } = await req.json();

    if (!leagueId || !startWeek || !endWeek) {
      throw new Error('leagueId, startWeek, and endWeek are required');
    }

    if (startWeek < 1 || endWeek > 18 || startWeek > endWeek) {
      throw new Error('Invalid week range (must be 1-18)');
    }

    console.log(`Fetching ESPN projections for league ${leagueId}, weeks ${startWeek}-${endWeek}`);

    // Get league info
    const { data: league, error: leagueError } = await supabase
      .from('connected_leagues')
      .select('league_id, platform')
      .eq('id', leagueId)
      .eq('user_id', user.id)
      .single();

    if (leagueError || !league) {
      throw new Error('League not found');
    }

    if (league.platform !== 'espn') {
      throw new Error('This function only supports ESPN leagues');
    }

    // Get credentials
    const { data: credentials, error: credError } = await supabaseUser.rpc('get_league_credentials', {
      p_user_id: user.id,
      p_platform: 'espn',
      p_league_id: league.league_id
    });

    if (credError || !credentials) {
      throw new Error('Unable to retrieve stored credentials');
    }

    const { espn_s2, swid } = credentials;

    const now = new Date();
    const currentSeason = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;

    // Build normalized player map
    const { data: normPlayers } = await supabase
      .from('normalized_players')
      .select('espn_id, player_id, player_name, position, team');

    const normalizedMap = new Map<string, any>();
    if (normPlayers) {
      for (const p of normPlayers) {
        if (p.espn_id) {
          normalizedMap.set(p.espn_id, p);
        }
      }
    }

    let totalProjectionsInserted = 0;

    // Fetch and process each week
    for (let week = startWeek; week <= endWeek; week++) {
      console.log(`Fetching projections for week ${week}...`);

      const leagueUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${currentSeason}/segments/0/leagues/${league.league_id}?scoringPeriodId=${week}&view=mRoster&view=kona_player_info`;

      const response = await fetch(leagueUrl, {
        headers: {
          'Cookie': `espn_s2=${espn_s2}; SWID=${swid}`,
        },
      });

      if (!response.ok) {
        console.error(`Failed to fetch week ${week}: ${response.status}`);
        continue;
      }

      const weekData = await response.json();
      const projectionStatsToInsert: any[] = [];

      // Also fetch waiver/FA players for complete pool
      const waiverFilter = {
        players: {
          filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
          filterStatsForExternalIds: { value: [currentSeason] },
          filterStatsForSourceIds: { value: [1] },
          filterStatsForTopScoringPeriodIds: {
            value: 2,
            additionalValue: [week]
          },
          limit: 2000,
          sortPercOwned: { sortPriority: 1, sortAsc: false }
        }
      };

      const waiverUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${currentSeason}/segments/0/leagues/${league.league_id}?scoringPeriodId=${week}&view=kona_player_info`;
      
      const waiverResponse = await fetch(waiverUrl, {
        headers: {
          'Cookie': `espn_s2=${espn_s2}; SWID=${swid}`,
          'X-Fantasy-Filter': JSON.stringify(waiverFilter),
        },
      });

      let waiverPlayers: any[] = [];
      if (waiverResponse.ok) {
        const waiverData = await waiverResponse.json();
        waiverPlayers = waiverData.players || [];
        console.log(`Week ${week}: Found ${waiverPlayers.length} waiver/FA players`);
      }

      console.log(`Week ${week} response has ${weekData.teams?.length || 0} teams`);
      
      // Log first player's stat structure to debug
      if (weekData.teams?.[0]?.roster?.entries?.[0]) {
        const firstEntry = weekData.teams[0].roster.entries[0];
        const firstPlayer = firstEntry.playerPoolEntry?.player;
        console.log(`First player: ${firstPlayer?.fullName}, stats array length: ${firstPlayer?.stats?.length || 0}`);
        if (firstPlayer?.stats?.length > 0) {
          console.log(`First stat entry:`, JSON.stringify(firstPlayer.stats[0]));
        }
      }

      // Process all teams
      for (const team of weekData.teams || []) {
        for (const entry of team.roster?.entries || []) {
          const player = entry.playerPoolEntry?.player;
          if (!player) continue;

          const espnId = entry.playerId?.toString();
          const normalizedPlayer = espnId ? normalizedMap.get(espnId) : null;

          // Look for PROJECTED stats for this week (statSourceId=1, statSplitTypeId=1)
          const weekProjection = player.stats?.find((stat: any) =>
            stat.statSourceId === 1 && 
            stat.statSplitTypeId === 1 && 
            stat.scoringPeriodId === week
          );

          console.log(`Player ${player.fullName}: found ${player.stats?.length || 0} stat entries, projection for week ${week}: ${weekProjection ? 'YES' : 'NO'}`);

          if (weekProjection?.stats || weekProjection?.appliedStats) {
            const rawStats = weekProjection.stats || {};
            const appliedStats = weekProjection.appliedStats || {};
            const position = normalizedPlayer?.position || player.defaultPositionId?.toString() || 'FLEX';
            const isDST = position === 'D/ST' || position === 'DEF' || position === '16';
            const isK = position === 'K' || position === '5' || player.defaultPositionId === 5;
            // Check if player is on bye (ESPN marks with specific indicators)
            const isByeWeek = (!rawStats || Object.keys(rawStats).length === 0) && (!appliedStats || Object.keys(appliedStats).length === 0);
            
            // Build normalized stats object from raw stats first
            const normalizedStats: any = {
              fumbles_lost: parseFloat(rawStats['72']) || 0,
            };
            
            // Add offensive stats for non-DST players
            if (!isDST && !isK) {
              normalizedStats.passing_yards = parseFloat(rawStats['3']) || 0;
              normalizedStats.passing_tds = parseFloat(rawStats['4']) || 0;
              normalizedStats.interceptions = parseFloat(rawStats['20']) || 0;
              normalizedStats.passing_completions = parseFloat(rawStats['1']) || 0;
              normalizedStats.passing_attempts = parseFloat(rawStats['0']) || 0;
              normalizedStats.passing_2pt_conversions = parseFloat(rawStats['19']) || 0;
              
              normalizedStats.rushing_yards = parseFloat(rawStats['24']) || 0;
              normalizedStats.rushing_tds = parseFloat(rawStats['25']) || 0;
              normalizedStats.rushing_attempts = parseFloat(rawStats['23']) || 0;
              normalizedStats.rushing_2pt_conversions = parseFloat(rawStats['26']) || 0;
              
              normalizedStats.receiving_yards = parseFloat(rawStats['42']) || 0;
              normalizedStats.receiving_tds = parseFloat(rawStats['43']) || 0;
              normalizedStats.receptions = parseFloat(rawStats['53']) || 0;
              normalizedStats.receiving_targets = parseFloat(rawStats['58']) || 0;
              normalizedStats.receiving_2pt_conversions = parseFloat(rawStats['44']) || 0;
            }
            
            // Add defensive stats for DST players
            if (isDST) {
              normalizedStats.interceptions = parseFloat(rawStats['95']) || 0;
              normalizedStats.sacks = parseFloat(rawStats['99']) || 0;
              normalizedStats.fumbles_recovered = parseFloat(rawStats['96']) || 0;
              normalizedStats.interception_tds = parseFloat(rawStats['103']) || 0;
              normalizedStats.fumble_recovery_tds = parseFloat(rawStats['104']) || 0;
              normalizedStats.defensive_tds = (parseFloat(rawStats['103']) || 0) + (parseFloat(rawStats['104']) || 0);
              normalizedStats.kick_return_tds = parseFloat(rawStats['101']) || 0;
              normalizedStats.punt_return_tds = parseFloat(rawStats['102']) || 0;
              normalizedStats.safeties = parseFloat(rawStats['98']) || 0;
              normalizedStats.blocked_kicks = parseFloat(rawStats['97']) || 0;
              // ESPN uses category-based scoring for PA/YA; raw counts may be missing in projections
              normalizedStats.points_allowed = rawStats['120'] !== undefined ? parseFloat(rawStats['120']) : undefined as any;
              normalizedStats.yards_allowed = rawStats['127'] !== undefined ? parseFloat(rawStats['127']) : undefined as any;
            }
            
            // Add kicker stats - check if rawStats are fractional (points) vs whole numbers (counts)
            if (isK) {
              const sample = parseFloat(rawStats['80']) || parseFloat(rawStats['83']) || 0;
              const looksLikePoints = sample > 0 && sample !== Math.floor(sample);
              
              // If rawStats look like points, skip and let appliedStats derivation handle it
              if (!looksLikePoints) {
                normalizedStats.fg_made_0_19 = parseFloat(rawStats['80']) || 0;
                normalizedStats.fg_made_20_29 = parseFloat(rawStats['81']) || 0;
                normalizedStats.fg_made_30_39 = parseFloat(rawStats['82']) || 0;
                normalizedStats.fg_made_40_49 = parseFloat(rawStats['83']) || 0;
                normalizedStats.fg_made_50_plus = parseFloat(rawStats['84']) || 0;
                normalizedStats.xp_made = parseFloat(rawStats['85']) || 0;
              }
            }
            
            // If everything is zero and appliedStats exist, derive estimates from appliedStats (league-scoring based)
            const sumVals = Object.values(normalizedStats).reduce((acc: number, v: any) => acc + (typeof v === 'number' ? Math.abs(v) : 0), 0);
            if (sumVals === 0 && appliedStats && Object.keys(appliedStats).length > 0) {
              // Derive approximate raw counts from applied stat points using common default scoring multipliers
              // Note: This is an approximation; actual league scoring may differ.
              const getNum = (k: string) => typeof appliedStats[k] === 'number' ? appliedStats[k] : parseFloat(appliedStats[k] || '0') || 0;
              if (!isDST && !isK) {
                normalizedStats.passing_yards = getNum('3') / 0.04;
                normalizedStats.passing_tds = getNum('4') / 4;
                normalizedStats.interceptions = Math.abs(getNum('20') / 2);
                normalizedStats.passing_2pt_conversions = getNum('19') / 2;
                
                normalizedStats.rushing_yards = getNum('24') / 0.1;
                normalizedStats.rushing_tds = getNum('25') / 6;
                normalizedStats.rushing_2pt_conversions = getNum('26') / 2;
                
                // Receptions are often 1 point in PPR (fallback to 0.5 if looks like half PPR)
                const recPts = getNum('53');
                const recPer = recPts >= 0.5 && recPts < 1 ? 0.5 : 1;
                normalizedStats.receptions = recPts / (recPer || 1);
                normalizedStats.receiving_yards = getNum('42') / 0.1;
                normalizedStats.receiving_tds = getNum('43') / 6;
                normalizedStats.receiving_2pt_conversions = getNum('44') / 2;
                
                normalizedStats.fumbles_lost = Math.abs(getNum('72') / 2);
              } else if (isK) {
                normalizedStats.fg_made_0_19 = getNum('80') / 3;
                normalizedStats.fg_made_20_29 = getNum('81') / 3;
                normalizedStats.fg_made_30_39 = getNum('82') / 3;
                normalizedStats.fg_made_40_49 = getNum('83') / 4;
                normalizedStats.fg_made_50_plus = getNum('84') / 5;
                normalizedStats.xp_made = getNum('85') / 1;
              } else {
                // DST projections are highly league-dependent; derive simple counts where 1:1 is common
                normalizedStats.interceptions = getNum('95') / 2;
                normalizedStats.sacks = getNum('99');
                normalizedStats.fumbles_recovered = getNum('96') / 2;
                const intTd = getNum('103') / 6;
                const fumTd = getNum('104') / 6;
                normalizedStats.interception_tds = intTd;
                normalizedStats.fumble_recovery_tds = fumTd;
                normalizedStats.defensive_tds = intTd + fumTd;
                normalizedStats.kick_return_tds = getNum('101') / 6;
                normalizedStats.punt_return_tds = getNum('102') / 6;
                normalizedStats.safeties = getNum('98') / 2;
                normalizedStats.blocked_kicks = getNum('97') / 2;
                // We cannot reliably derive points/yards allowed; leave undefined
                normalizedStats.points_allowed = undefined as any;
                normalizedStats.yards_allowed = undefined as any;
              }
            }
            
            // Preserve applied breakdown for debugging/transparency
            if (appliedStats && Object.keys(appliedStats).length > 0) {
              (normalizedStats as any).__applied_breakdown = appliedStats;
            }
            
            // Calculate projected_fp
            let projected_fp: number | undefined;
            
            if (isK && appliedStats && Object.keys(appliedStats).length > 0) {
              // For kickers, sum all values in appliedStats
              projected_fp = Object.values(appliedStats).reduce((sum: number, val: any) => {
                const num = typeof val === 'number' ? val : parseFloat(val || '0') || 0;
                return sum + num;
              }, 0);
            } else if (typeof weekProjection.appliedTotal === 'number') {
              // For non-kickers, use appliedTotal if available
              projected_fp = weekProjection.appliedTotal;
            }
            
            if (projected_fp !== undefined) {
              (normalizedStats as any).projected_fp = projected_fp;
            }
            
            // Create projection entry
            const projectionEntry = {
              player_id: normalizedPlayer?.player_id || `espn_${espnId}`,
              player_name: normalizedPlayer?.player_name || player.fullName || 'Unknown',
              team: normalizedPlayer?.team || (player.proTeamId ? getTeamAbbreviation(player.proTeamId) : null),
              position: position,
              provider_ids: espnId ? { espn: espnId } : {},
              week: week,
              season: currentSeason,
              source: 'espn_projection',
              stats: normalizedStats,
              confidence: 0.75,
              status_flags: {
                bye: isByeWeek,
                inactive: false,
              },
              waiver_status: 'ROSTERED',
              percent_owned: 100,
              percent_started: 0,
              projected_fp: projected_fp,
              applied_breakdown: appliedStats,
              last_updated: new Date().toISOString(),
            };
            
            projectionStatsToInsert.push(projectionEntry);

            // Add normalized player if missing
            if (!normalizedPlayer && espnId) {
              const newPlayer = {
                player_id: `espn_${espnId}`,
                espn_id: espnId,
                player_name: player.fullName || 'Unknown',
                position: player.defaultPositionId?.toString() || 'FLEX',
                team: player.proTeamId ? getTeamAbbreviation(player.proTeamId) : 'FA',
              };
              normalizedMap.set(espnId, newPlayer);
              await supabase
                .from('normalized_players')
                .upsert([newPlayer], { onConflict: 'espn_id', ignoreDuplicates: true });
            }
          }
        }
      }

      // Process waiver/FA players
      for (const playerData of waiverPlayers) {
        const player = playerData.player;
        if (!player) continue;

        const espnId = player.id?.toString();
        const normalizedPlayer = espnId ? normalizedMap.get(espnId) : null;

        // Skip if already processed from rosters
        if (projectionStatsToInsert.some(p => p.provider_ids?.espn === espnId)) {
          continue;
        }

        const ownership = playerData.ownership || {};
        const waiverStatus = playerData.status === 'FREEAGENT' ? 'FREEAGENT' : 'WAIVERS';

        const weekProjection = player.stats?.find((stat: any) =>
          stat.statSourceId === 1 && 
          stat.scoringPeriodId === week &&
          stat.seasonId === currentSeason
        );

        if (weekProjection?.stats || weekProjection?.appliedStats) {
          const rawStats = weekProjection.stats || {};
          const appliedStats = weekProjection.appliedStats || {};
          const position = normalizedPlayer?.position || player.defaultPositionId?.toString() || 'FLEX';
          const isDST = position === 'D/ST' || position === 'DEF' || position === '16';
          const isK = position === 'K' || position === '5' || player.defaultPositionId === 5;
          const isByeWeek = (!rawStats || Object.keys(rawStats).length === 0) && (!appliedStats || Object.keys(appliedStats).length === 0);
          
          const normalizedStats: any = {
            fumbles_lost: parseFloat(rawStats['72']) || 0,
          };
          
          if (!isDST && !isK) {
            normalizedStats.passing_yards = parseFloat(rawStats['3']) || 0;
            normalizedStats.passing_tds = parseFloat(rawStats['4']) || 0;
            normalizedStats.interceptions = parseFloat(rawStats['20']) || 0;
            normalizedStats.passing_completions = parseFloat(rawStats['1']) || 0;
            normalizedStats.passing_attempts = parseFloat(rawStats['0']) || 0;
            normalizedStats.passing_2pt_conversions = parseFloat(rawStats['19']) || 0;
            
            normalizedStats.rushing_yards = parseFloat(rawStats['24']) || 0;
            normalizedStats.rushing_tds = parseFloat(rawStats['25']) || 0;
            normalizedStats.rushing_attempts = parseFloat(rawStats['23']) || 0;
            normalizedStats.rushing_2pt_conversions = parseFloat(rawStats['26']) || 0;
            
            normalizedStats.receiving_yards = parseFloat(rawStats['42']) || 0;
            normalizedStats.receiving_tds = parseFloat(rawStats['43']) || 0;
            normalizedStats.receptions = parseFloat(rawStats['53']) || 0;
            normalizedStats.receiving_targets = parseFloat(rawStats['58']) || 0;
            normalizedStats.receiving_2pt_conversions = parseFloat(rawStats['44']) || 0;
          }
          
          if (isDST) {
            normalizedStats.interceptions = parseFloat(rawStats['95']) || 0;
            normalizedStats.sacks = parseFloat(rawStats['99']) || 0;
            normalizedStats.fumbles_recovered = parseFloat(rawStats['96']) || 0;
            normalizedStats.interception_tds = parseFloat(rawStats['103']) || 0;
            normalizedStats.fumble_recovery_tds = parseFloat(rawStats['104']) || 0;
            normalizedStats.defensive_tds = (parseFloat(rawStats['103']) || 0) + (parseFloat(rawStats['104']) || 0);
            normalizedStats.kick_return_tds = parseFloat(rawStats['101']) || 0;
            normalizedStats.punt_return_tds = parseFloat(rawStats['102']) || 0;
            normalizedStats.safeties = parseFloat(rawStats['98']) || 0;
            normalizedStats.blocked_kicks = parseFloat(rawStats['97']) || 0;
          }
          
          if (isK) {
            normalizedStats.fg_made_0_19 = parseFloat(rawStats['80']) || 0;
            normalizedStats.fg_made_20_29 = parseFloat(rawStats['81']) || 0;
            normalizedStats.fg_made_30_39 = parseFloat(rawStats['82']) || 0;
            normalizedStats.fg_made_40_49 = parseFloat(rawStats['83']) || 0;
            normalizedStats.fg_made_50_plus = parseFloat(rawStats['84']) || 0;
            normalizedStats.xp_made = parseFloat(rawStats['85']) || 0;
          }
          
          if (appliedStats && Object.keys(appliedStats).length > 0) {
            (normalizedStats as any).__applied_breakdown = appliedStats;
          }
          
          let projected_fp: number | undefined;
          if (isK && appliedStats && Object.keys(appliedStats).length > 0) {
            projected_fp = Object.values(appliedStats).reduce((sum: number, val: any) => {
              const num = typeof val === 'number' ? val : parseFloat(val || '0') || 0;
              return sum + num;
            }, 0);
          } else if (typeof weekProjection.appliedTotal === 'number') {
            projected_fp = weekProjection.appliedTotal;
          }
          
          if (projected_fp !== undefined) {
            (normalizedStats as any).projected_fp = projected_fp;
          }
          
          const projectionEntry = {
            player_id: normalizedPlayer?.player_id || `espn_${espnId}`,
            player_name: normalizedPlayer?.player_name || player.fullName || 'Unknown',
            team: normalizedPlayer?.team || (player.proTeamId ? getTeamAbbreviation(player.proTeamId) : null),
            position: position,
            provider_ids: espnId ? { espn: espnId } : {},
            week: week,
            season: currentSeason,
            source: 'espn_projection',
            stats: normalizedStats,
            confidence: 0.75,
            status_flags: {
              bye: isByeWeek,
              inactive: false,
            },
            waiver_status: waiverStatus,
            percent_owned: ownership.percentOwned || 0,
            percent_started: ownership.percentStarted || 0,
            projected_fp: projected_fp,
            applied_breakdown: appliedStats,
            last_updated: new Date().toISOString(),
          };
          
          projectionStatsToInsert.push(projectionEntry);

          // Add normalized player if missing
          if (!normalizedPlayer && espnId) {
            const newPlayer = {
              player_id: `espn_${espnId}`,
              espn_id: espnId,
              player_name: player.fullName || 'Unknown',
              position: player.defaultPositionId?.toString() || 'FLEX',
              team: player.proTeamId ? getTeamAbbreviation(player.proTeamId) : 'FA',
            };
            normalizedMap.set(espnId, newPlayer);
            await supabase
              .from('normalized_players')
              .upsert([newPlayer], { onConflict: 'espn_id', ignoreDuplicates: true });
          }
        }
      }

      // Batch insert projections for this week
      if (projectionStatsToInsert.length > 0) {
        await supabase
          .from('projected_player_stats')
          .upsert(projectionStatsToInsert, {
            onConflict: 'player_id,season,week,source',
            ignoreDuplicates: false
          });
        console.log(`Inserted ${projectionStatsToInsert.length} projections for week ${week}`);
        totalProjectionsInserted += projectionStatsToInsert.length;
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
