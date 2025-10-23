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
            
            // Check if player is on bye (ESPN marks with specific indicators)
            const isByeWeek = (!rawStats || Object.keys(rawStats).length === 0) && (!appliedStats || Object.keys(appliedStats).length === 0);
            
            // Build normalized stats object from raw stats first
            const normalizedStats: any = {
              fumbles_lost: parseInt(rawStats['72']) || 0,
            };
            
            // Add offensive stats for non-DST players
            if (!isDST) {
              normalizedStats.passing_yards = Math.round(parseFloat(rawStats['3']) || 0);
              normalizedStats.passing_tds = parseInt(rawStats['4']) || 0;
              normalizedStats.interceptions = parseInt(rawStats['20']) || 0;
              normalizedStats.passing_completions = parseInt(rawStats['1']) || 0;
              normalizedStats.passing_attempts = parseInt(rawStats['0']) || 0;
              normalizedStats.passing_2pt_conversions = parseInt(rawStats['19']) || 0;
              
              normalizedStats.rushing_yards = Math.round(parseFloat(rawStats['24']) || 0);
              normalizedStats.rushing_tds = parseInt(rawStats['25']) || 0;
              normalizedStats.rushing_attempts = parseInt(rawStats['23']) || 0;
              normalizedStats.rushing_2pt_conversions = parseInt(rawStats['26']) || 0;
              
              normalizedStats.receiving_yards = Math.round(parseFloat(rawStats['42']) || 0);
              normalizedStats.receiving_tds = parseInt(rawStats['43']) || 0;
              normalizedStats.receptions = parseInt(rawStats['53']) || 0;
              normalizedStats.receiving_targets = parseInt(rawStats['58']) || 0;
              normalizedStats.receiving_2pt_conversions = parseInt(rawStats['44']) || 0;
            }
            
            // Add defensive stats for DST players
            if (isDST) {
              normalizedStats.sacks = parseFloat(rawStats['99']) || 0;
              normalizedStats.fumbles_recovered = parseInt(rawStats['96']) || 0;
              normalizedStats.interception_tds = parseInt(rawStats['103']) || 0;
              normalizedStats.fumble_recovery_tds = parseInt(rawStats['104']) || 0;
              normalizedStats.defensive_tds = (parseInt(rawStats['103']) || 0) + (parseInt(rawStats['104']) || 0);
              normalizedStats.kick_return_tds = parseInt(rawStats['101']) || 0;
              normalizedStats.punt_return_tds = parseInt(rawStats['102']) || 0;
              normalizedStats.safeties = parseInt(rawStats['98']) || 0;
              normalizedStats.blocked_kicks = parseInt(rawStats['97']) || 0;
              // ESPN uses category-based scoring for PA/YA; raw counts may be missing in projections
              normalizedStats.points_allowed = parseInt(rawStats['120']) || undefined as any;
              normalizedStats.yards_allowed = parseInt(rawStats['127']) || undefined as any;
            }
            
            // If everything is zero and appliedStats exist, derive estimates from appliedStats (league-scoring based)
            const sumVals = Object.values(normalizedStats).reduce((acc: number, v: any) => acc + (typeof v === 'number' ? Math.abs(v) : 0), 0);
            if (sumVals === 0 && appliedStats && Object.keys(appliedStats).length > 0) {
              // Derive approximate raw counts from applied stat points using common default scoring multipliers
              // Note: This is an approximation; actual league scoring may differ.
              const getNum = (k: string) => typeof appliedStats[k] === 'number' ? appliedStats[k] : parseFloat(appliedStats[k] || '0') || 0;
              if (!isDST) {
                normalizedStats.passing_yards = Math.round(getNum('3') / 0.04);
                normalizedStats.passing_tds = Math.round(getNum('4') / 4);
                normalizedStats.interceptions = Math.round(Math.abs(getNum('20') / 2));
                normalizedStats.passing_2pt_conversions = Math.round(getNum('19') / 2);
                
                normalizedStats.rushing_yards = Math.round(getNum('24') / 0.1);
                normalizedStats.rushing_tds = Math.round(getNum('25') / 6);
                normalizedStats.rushing_2pt_conversions = Math.round(getNum('26') / 2);
                
                // Receptions are often 1 point in PPR (fallback to 0.5 if looks like half PPR)
                const recPts = getNum('53');
                const recPer = recPts >= 0.5 && recPts < 1 ? 0.5 : 1;
                normalizedStats.receptions = Math.round(recPts / (recPer || 1));
                normalizedStats.receiving_yards = Math.round(getNum('42') / 0.1);
                normalizedStats.receiving_tds = Math.round(getNum('43') / 6);
                normalizedStats.receiving_2pt_conversions = Math.round(getNum('44') / 2);
                
                normalizedStats.fumbles_lost = Math.round(Math.abs(getNum('72') / 2));
              } else {
                // DST projections are highly league-dependent; derive simple counts where 1:1 is common
                normalizedStats.sacks = Math.round(getNum('99'));
                normalizedStats.fumbles_recovered = Math.round(getNum('96') / 2);
                const intTd = Math.round(getNum('103') / 6);
                const fumTd = Math.round(getNum('104') / 6);
                normalizedStats.interception_tds = intTd;
                normalizedStats.fumble_recovery_tds = fumTd;
                normalizedStats.defensive_tds = intTd + fumTd;
                normalizedStats.kick_return_tds = Math.round(getNum('101') / 6);
                normalizedStats.punt_return_tds = Math.round(getNum('102') / 6);
                normalizedStats.safeties = Math.round(getNum('98') / 2);
                normalizedStats.blocked_kicks = Math.round(getNum('97') / 2);
                // We cannot reliably derive points/yards allowed; leave undefined
                normalizedStats.points_allowed = undefined as any;
                normalizedStats.yards_allowed = undefined as any;
              }
              // Preserve applied total and breakdown for consumers that rely on league-specific scoring
              (normalizedStats as any).__applied_total = typeof weekProjection.appliedTotal === 'number' ? weekProjection.appliedTotal : undefined;
              (normalizedStats as any).__applied_breakdown = appliedStats;
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
