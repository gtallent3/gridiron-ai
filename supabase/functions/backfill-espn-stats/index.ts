import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";

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

    console.log(`Backfilling ESPN stats for league ${leagueId}, weeks ${startWeek}-${endWeek}`);

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
    // NFL season runs Sep-Feb, so if we're in Sep-Dec use current year, if Jan-Aug use previous year
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

    let totalStatsInserted = 0;

    // Fetch and process each week
    for (let week = startWeek; week <= endWeek; week++) {
      console.log(`Fetching stats for week ${week}...`);

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
      const playerStatsToInsert: any[] = [];

      // Process all teams
      for (const team of weekData.teams || []) {
        for (const entry of team.roster?.entries || []) {
          const player = entry.playerPoolEntry?.player;
          if (!player) continue;

          const espnId = entry.playerId?.toString();
          const normalizedPlayer = espnId ? normalizedMap.get(espnId) : null;

          // Look for actual stats for this week
          const weekActual = player.stats?.find((stat: any) =>
            stat.statSourceId === 0 && stat.scoringPeriodId === week
          );

          if (weekActual?.stats) {
            const rawStats = weekActual.stats;
            const position = normalizedPlayer?.position || player.defaultPositionId?.toString() || 'FLEX';
            const isDST = position === 'D/ST' || position === 'DEF' || position === '16';
            
            // Base stat object with common stats
            const statEntry: any = {
              player_id: normalizedPlayer?.player_id || `espn_${espnId}`,
              player_name: normalizedPlayer?.player_name || player.fullName || 'Unknown',
              team: normalizedPlayer?.team || (player.proTeamId ? getTeamAbbreviation(player.proTeamId) : null),
              position: position,
              week: week,
              season: currentSeason,
              fumbles_lost: parseInt(rawStats['72']) || 0,
              source: 'espn',
              source_type: 'actual',
              confidence: 0.95,
              freshness_ts: new Date().toISOString(),
              finalized: true,
              raw_data: weekActual,
            };
            
            // Add offensive stats for non-DST players
            if (!isDST) {
              statEntry.passing_yards = Math.round(parseFloat(rawStats['3']) || 0);
              statEntry.passing_tds = parseInt(rawStats['4']) || 0;
              statEntry.interceptions = parseInt(rawStats['20']) || 0;
              statEntry.passing_completions = parseInt(rawStats['1']) || 0;
              statEntry.passing_attempts = parseInt(rawStats['0']) || 0;
              statEntry.passing_2pt_conversions = parseInt(rawStats['19']) || 0;
              
              statEntry.rushing_yards = Math.round(parseFloat(rawStats['24']) || 0);
              statEntry.rushing_tds = parseInt(rawStats['25']) || 0;
              statEntry.rushing_attempts = parseInt(rawStats['23']) || 0;
              statEntry.rushing_2pt_conversions = parseInt(rawStats['26']) || 0;
              
              statEntry.receiving_yards = Math.round(parseFloat(rawStats['42']) || 0);
              statEntry.receiving_tds = parseInt(rawStats['43']) || 0;
              statEntry.receptions = parseInt(rawStats['53']) || 0;
              statEntry.receiving_targets = parseInt(rawStats['58']) || 0;
              statEntry.receiving_2pt_conversions = parseInt(rawStats['44']) || 0;
            }
            
            // Add defensive stats for DST players
            if (isDST) {
              statEntry.sacks = parseFloat(rawStats['99']) || 0;
              statEntry.fumbles_recovered = parseInt(rawStats['96']) || 0;
              statEntry.interception_tds = parseInt(rawStats['103']) || 0;
              statEntry.fumble_recovery_tds = parseInt(rawStats['104']) || 0;
              statEntry.defensive_tds = (parseInt(rawStats['103']) || 0) + (parseInt(rawStats['104']) || 0);
              statEntry.kick_return_tds = parseInt(rawStats['101']) || 0;
              statEntry.punt_return_tds = parseInt(rawStats['102']) || 0;
              statEntry.safeties = parseInt(rawStats['98']) || 0;
              statEntry.blocked_kicks = parseInt(rawStats['97']) || 0;
              statEntry.points_allowed = parseInt(rawStats['120']) || 0;
              statEntry.yards_allowed = parseInt(rawStats['127']) || 0;
            }
            
            playerStatsToInsert.push(statEntry);

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

      // Batch insert stats for this week into nfl_fantasy_points
      if (playerStatsToInsert.length > 0) {
        await supabase
          .from('nfl_fantasy_points')
          .upsert(playerStatsToInsert.map(s => ({
            player_id: s.player_id,
            player_name: s.player_name,
            team: s.team,
            position: s.position,
            week: s.week,
            season: s.season,
            fantasy_points_ppr: s.fantasy_points_ppr || 0
          })), {
            onConflict: 'player_id,week,season',
            ignoreDuplicates: false
          });
        console.log(`Inserted ${playerStatsToInsert.length} stats for week ${week}`);
        totalStatsInserted += playerStatsToInsert.length;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Backfilled weeks ${startWeek}-${endWeek}`,
        stats_inserted: totalStatsInserted
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Backfill error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
