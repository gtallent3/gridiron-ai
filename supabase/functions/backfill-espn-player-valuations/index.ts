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

    // Fetch player stats for the specific week
    const statsUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${currentSeason}/segments/0/leagues/${leagueId}?scoringPeriodId=${week}&view=kona_player_info`;
    const statsResponse = await fetch(statsUrl, {
      headers: { 'Cookie': `espn_s2=${espn_s2}; SWID=${swid}` }
    });

    if (!statsResponse.ok) {
      throw new Error(`Failed to fetch stats for week ${week}`);
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

      // Find stats for this specific week
      const weekStats = player.stats?.find((s: any) => s.scoringPeriodId === week && s.statSourceId === 0);
      
      if (!weekStats || !weekStats.stats) continue;

      // Calculate actual points using league's scoring settings
      let actualPoints = 0;
      for (const [statId, statValue] of Object.entries(weekStats.stats)) {
        const scoringItem = scoringItems[statId];
        if (scoringItem && typeof scoringItem.points === 'number') {
          actualPoints += scoringItem.points * (statValue as number);
        }
      }

      // Round to 2 decimal places
      actualPoints = Math.round(actualPoints * 100) / 100;

      // Determine if this week is a bye week (no stats recorded)
      const isByeWeek = actualPoints === 0 && Object.keys(weekStats.stats).length === 0;

      // For projections, we'll use simple averages from historical data
      // This is a simplified approach - in production you'd want more sophisticated logic
      const ppgProjection = actualPoints;
      const rosProjection = actualPoints * (18 - week); // Simple projection
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
        remaining_bye_weeks: isByeWeek ? 0 : 1, // Simplified
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
