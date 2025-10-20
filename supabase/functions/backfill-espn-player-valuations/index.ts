import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ESPN Pro Team ID to abbreviation mapping
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
    const { week, leagueId } = await req.json();
    
    if (!week || week < 1 || week > 18) {
      return new Response(
        JSON.stringify({ error: 'Valid week parameter (1-18) is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!leagueId) {
      return new Response(
        JSON.stringify({ error: 'League ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    console.log(`Starting ESPN backfill for league ${leagueId}, week ${week}...`);

    // Get stored credentials
    const { data: credentials, error: credError } = await supabaseUser.rpc('get_league_credentials', {
      p_user_id: user.id,
      p_platform: 'espn',
      p_league_id: leagueId
    });

    if (credError || !credentials) {
      throw new Error('No credentials found for this league');
    }

    const { espn_s2, swid } = credentials;

    const now = new Date();
    const currentSeason = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;

    // Fetch league settings to get scoring configuration
    const leagueUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${currentSeason}/segments/0/leagues/${leagueId}?view=mSettings`;
    const leagueResponse = await fetch(leagueUrl, {
      headers: { 'Cookie': `espn_s2=${espn_s2}; SWID=${swid}` }
    });

    if (!leagueResponse.ok) {
      throw new Error('Failed to fetch league settings');
    }

    const leagueData = await leagueResponse.json();
    const scoringItems = leagueData.settings?.scoringSettings?.scoringItems || {};

    // Fetch league-specific player info with applied totals for the target week
    const statsUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${currentSeason}/segments/0/leagues/${leagueId}?scoringPeriodId=${week}&view=kona_player_info`;
    
    console.log(`Fetching league player stats for week ${week}...`);
    
    const statsResponse = await fetch(statsUrl, {
      headers: { 'Cookie': `espn_s2=${espn_s2}; SWID=${swid}` }
    });

    if (!statsResponse.ok) {
      throw new Error(`Failed to fetch stats for week ${week}: ${statsResponse.status}`);
    }

    const statsData = await statsResponse.json();
    const players = statsData.players || [];

    console.log(`Fetched ${players.length} players from ESPN for week ${week}`);

    const valuations: any[] = [];

    for (const playerData of players) {
      const player = playerData.player;
      if (!player) continue;

      const playerId = String(player.id);
      const fullName = player.fullName;
      const position = player.defaultPositionId;
      
      // Map ESPN position IDs to standard positions
      const positionMap: Record<number, string> = {
        1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF'
      };
      const positionName = positionMap[position] || 'FLEX';

      // Skip if not a fantasy-relevant position
      if (!['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(positionName)) continue;

      const proTeamId = player.proTeamId;
      const team = getTeamAbbreviation(proTeamId);
      
      // Get injury status
      const injuryStatus = player.injuryStatus || null;
      const injuryMap: Record<string, string | null> = {
        'ACTIVE': null,
        'QUESTIONABLE': 'Questionable',
        'DOUBTFUL': 'Doubtful',
        'OUT': 'Out',
        'INJURY_RESERVE': 'IR',
        'PHYSICALLY_UNABLE_TO_PERFORM': 'PUP'
      };

      // Find actual stats for this specific week (statSourceId: 0 = actual)
      const weekStats = player.stats?.find((s: any) => s.scoringPeriodId === week && s.statSourceId === 0);
      
      // Determine bye vs played and use ESPN-applied points when available
      let isByeWeek = false;
      let actualPoints = 0;

      if (!weekStats) {
        // No stat line at all for this period -> likely bye or inactive
        isByeWeek = true;
        actualPoints = 0;
      } else if (typeof weekStats.appliedTotal === 'number') {
        // ESPN already computed points using league settings - this is the correct approach!
        actualPoints = Number(weekStats.appliedTotal);
        console.log(`${fullName}: Using ESPN applied total ${actualPoints} points for week ${week}`);
      } else if (weekStats.stats && Object.keys(weekStats.stats).length > 0) {
        // Fallback: compute from raw stats and league scoring
        const rawStats = weekStats.stats;
        console.log(`${fullName} (${positionName}) week ${week} raw stats:`, Object.keys(rawStats).length, 'stats');
        for (const [statId, statValue] of Object.entries(rawStats)) {
          const scoringItem = scoringItems[statId as keyof typeof scoringItems];
          if (scoringItem && typeof (scoringItem as any).points === 'number' && typeof statValue === 'number') {
            const points = (scoringItem as any).points * statValue;
            actualPoints += points;
            if (Math.abs(points) > 1) {
              console.log(`  Stat ${statId}: ${statValue} × ${(scoringItem as any).points} = ${points.toFixed(2)}`);
            }
          }
        }
      } else {
        // Has a stat line but empty stats -> treat as zero
        actualPoints = 0;
      }

      // Round to 2 decimals for storage consistency
      actualPoints = Math.round(actualPoints * 100) / 100;

      console.log(`${fullName}: ${actualPoints} points in week ${week}`);

      // For projections, use actual data as baseline
      const ppgProjection = actualPoints;
      const rosProjection = actualPoints * (18 - week);
      const next3WeeksProjection = actualPoints * 3;
      const championshipProjection = actualPoints * 3;

      valuations.push({
        player_id: `espn_${playerId}`,
        player_name: fullName,
        position: positionName,
        team: team,
        week: week,
        season: currentSeason,
        ppg_projection: ppgProjection,
        player_value: actualPoints,
        ros_projection: rosProjection,
        next_3_weeks_projection: next3WeeksProjection,
        championship_weeks_projection: championshipProjection,
        injury_status: injuryMap[injuryStatus] || null,
        injury_risk: injuryStatus && injuryStatus !== 'ACTIVE' ? 0.3 : 0,
        injury_duration_weeks: injuryStatus === 'INJURY_RESERVE' ? 4 : injuryStatus === 'OUT' ? 1 : 0,
        is_bye_week: isByeWeek,
        remaining_bye_weeks: 0,
        schedule_difficulty: 0,
        playoff_schedule_difficulty: 0,
        usage_trend: 0,
        role_stability: 1,
        sentiment_score: 0,
        volatility_flag: false,
        confidence_score: 80,
        remaining_schedule: null
      });
    }

    console.log(`Generated ${valuations.length} player valuations for week ${week}`);

    // Delete existing valuations for this week
    const { error: deleteError } = await supabase
      .from('player_valuations')
      .delete()
      .eq('week', week)
      .eq('season', currentSeason)
      .like('player_id', 'espn_%');

    if (deleteError) {
      console.error('Error deleting old valuations:', deleteError);
    }

    // Insert new valuations
    if (valuations.length > 0) {
      const { error: insertError } = await supabase
        .from('player_valuations')
        .insert(valuations);

      if (insertError) {
        console.error('Error inserting valuations:', insertError);
        throw new Error('Failed to store player valuations');
      }
    }

    console.log(`Successfully backfilled ${valuations.length} ESPN player valuations for week ${week}`);

    return new Response(
      JSON.stringify({
        success: true,
        count: valuations.length,
        week: week,
        season: currentSeason,
        source: 'espn'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Backfill error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});