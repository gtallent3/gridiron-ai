import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PlayerStats {
  passing_yards?: number;
  passing_tds?: number;
  passing_attempts?: number;
  passing_completions?: number;
  interceptions?: number;
  passing_2pt_conversions?: number;
  rushing_yards?: number;
  rushing_tds?: number;
  rushing_attempts?: number;
  rushing_2pt_conversions?: number;
  receptions?: number;
  receiving_yards?: number;
  receiving_tds?: number;
  receiving_targets?: number;
  receiving_2pt_conversions?: number;
  fg_made?: number;
  fg_made_0_19?: number;
  fg_made_20_29?: number;
  fg_made_30_39?: number;
  fg_made_40_49?: number;
  fg_made_50_plus?: number;
  xp_made?: number;
  fumbles_lost?: number;
  sacks?: number;
  fumbles_recovered?: number;
  interception_tds?: number;
  fumble_recovery_tds?: number;
  defensive_tds?: number;
  kick_return_tds?: number;
  punt_return_tds?: number;
  safeties?: number;
  blocked_kicks?: number;
  points_allowed?: number;
  yards_allowed?: number;
}

interface ScoringSettings {
  // Passing
  passing_yards?: number;
  passing_tds?: number;
  passing_attempts?: number;
  passing_completions?: number;
  interceptions?: number;
  passing_2pt_conversions?: number;
  
  // Rushing
  rushing_yards?: number;
  rushing_tds?: number;
  rushing_attempts?: number;
  rushing_2pt_conversions?: number;
  
  // Receiving
  receptions?: number;
  receiving_yards?: number;
  receiving_tds?: number;
  receiving_targets?: number;
  receiving_2pt_conversions?: number;
  
  // Kicking
  fg_made?: number;
  fg_missed?: number;
  fg_made_0_19?: number;
  fg_made_20_29?: number;
  fg_made_30_39?: number;
  fg_made_40_49?: number;
  fg_made_50_plus?: number;
  xp_made?: number;
  xp_missed?: number;
  
  // Defense
  sacks?: number;
  fumbles_recovered?: number;
  interception_tds?: number;
  fumble_recovery_tds?: number;
  defensive_tds?: number;
  kick_return_tds?: number;
  punt_return_tds?: number;
  safeties?: number;
  blocked_kicks?: number;
  
  // Misc
  fumbles_lost?: number;
  points_allowed_0?: number;
  points_allowed_1_6?: number;
  points_allowed_7_13?: number;
  points_allowed_14_20?: number;
  points_allowed_21_27?: number;
  points_allowed_28_34?: number;
  points_allowed_35_plus?: number;
  yards_allowed_0_99?: number;
  yards_allowed_100_199?: number;
  yards_allowed_200_299?: number;
  yards_allowed_300_399?: number;
  yards_allowed_400_499?: number;
  yards_allowed_500_plus?: number;
}

// Default PPR scoring settings
const DEFAULT_SCORING: ScoringSettings = {
  passing_yards: 0.04,
  passing_tds: 4,
  interceptions: -2,
  passing_2pt_conversions: 2,
  rushing_yards: 0.1,
  rushing_tds: 6,
  rushing_2pt_conversions: 2,
  receptions: 1, // PPR
  receiving_yards: 0.1,
  receiving_tds: 6,
  receiving_2pt_conversions: 2,
  fg_made_0_19: 3,
  fg_made_20_29: 3,
  fg_made_30_39: 3,
  fg_made_40_49: 4,
  fg_made_50_plus: 5,
  xp_made: 1,
  fumbles_lost: -2,
  sacks: 1,
  fumbles_recovered: 2,
  interception_tds: 6,
  fumble_recovery_tds: 6,
  defensive_tds: 6,
  safeties: 2,
  blocked_kicks: 2,
};

function calculateFantasyPoints(stats: PlayerStats, scoring: ScoringSettings): { total: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let total = 0;

  // Passing
  if (stats.passing_yards) {
    const points = stats.passing_yards * (scoring.passing_yards || 0);
    breakdown.passing_yards = points;
    total += points;
  }
  if (stats.passing_tds) {
    const points = stats.passing_tds * (scoring.passing_tds || 0);
    breakdown.passing_tds = points;
    total += points;
  }
  if (stats.interceptions) {
    const points = stats.interceptions * (scoring.interceptions || 0);
    breakdown.interceptions = points;
    total += points;
  }
  if (stats.passing_2pt_conversions) {
    const points = stats.passing_2pt_conversions * (scoring.passing_2pt_conversions || 0);
    breakdown.passing_2pt_conversions = points;
    total += points;
  }

  // Rushing
  if (stats.rushing_yards) {
    const points = stats.rushing_yards * (scoring.rushing_yards || 0);
    breakdown.rushing_yards = points;
    total += points;
  }
  if (stats.rushing_tds) {
    const points = stats.rushing_tds * (scoring.rushing_tds || 0);
    breakdown.rushing_tds = points;
    total += points;
  }
  if (stats.rushing_2pt_conversions) {
    const points = stats.rushing_2pt_conversions * (scoring.rushing_2pt_conversions || 0);
    breakdown.rushing_2pt_conversions = points;
    total += points;
  }

  // Receiving
  if (stats.receptions) {
    const points = stats.receptions * (scoring.receptions || 0);
    breakdown.receptions = points;
    total += points;
  }
  if (stats.receiving_yards) {
    const points = stats.receiving_yards * (scoring.receiving_yards || 0);
    breakdown.receiving_yards = points;
    total += points;
  }
  if (stats.receiving_tds) {
    const points = stats.receiving_tds * (scoring.receiving_tds || 0);
    breakdown.receiving_tds = points;
    total += points;
  }
  if (stats.receiving_2pt_conversions) {
    const points = stats.receiving_2pt_conversions * (scoring.receiving_2pt_conversions || 0);
    breakdown.receiving_2pt_conversions = points;
    total += points;
  }

  // Kicking
  if (stats.fg_made_0_19) {
    const points = stats.fg_made_0_19 * (scoring.fg_made_0_19 || 0);
    breakdown.fg_made_0_19 = points;
    total += points;
  }
  if (stats.fg_made_20_29) {
    const points = stats.fg_made_20_29 * (scoring.fg_made_20_29 || 0);
    breakdown.fg_made_20_29 = points;
    total += points;
  }
  if (stats.fg_made_30_39) {
    const points = stats.fg_made_30_39 * (scoring.fg_made_30_39 || 0);
    breakdown.fg_made_30_39 = points;
    total += points;
  }
  if (stats.fg_made_40_49) {
    const points = stats.fg_made_40_49 * (scoring.fg_made_40_49 || 0);
    breakdown.fg_made_40_49 = points;
    total += points;
  }
  if (stats.fg_made_50_plus) {
    const points = stats.fg_made_50_plus * (scoring.fg_made_50_plus || 0);
    breakdown.fg_made_50_plus = points;
    total += points;
  }
  if (stats.xp_made) {
    const points = stats.xp_made * (scoring.xp_made || 0);
    breakdown.xp_made = points;
    total += points;
  }

  // Defense/Special Teams
  if (stats.sacks) {
    const points = stats.sacks * (scoring.sacks || 0);
    breakdown.sacks = points;
    total += points;
  }
  if (stats.fumbles_recovered) {
    const points = stats.fumbles_recovered * (scoring.fumbles_recovered || 0);
    breakdown.fumbles_recovered = points;
    total += points;
  }
  if (stats.interception_tds) {
    const points = stats.interception_tds * (scoring.interception_tds || 0);
    breakdown.interception_tds = points;
    total += points;
  }
  if (stats.fumble_recovery_tds) {
    const points = stats.fumble_recovery_tds * (scoring.fumble_recovery_tds || 0);
    breakdown.fumble_recovery_tds = points;
    total += points;
  }
  if (stats.defensive_tds) {
    const points = stats.defensive_tds * (scoring.defensive_tds || 0);
    breakdown.defensive_tds = points;
    total += points;
  }
  if (stats.kick_return_tds) {
    const points = stats.kick_return_tds * (scoring.kick_return_tds || 0);
    breakdown.kick_return_tds = points;
    total += points;
  }
  if (stats.punt_return_tds) {
    const points = stats.punt_return_tds * (scoring.punt_return_tds || 0);
    breakdown.punt_return_tds = points;
    total += points;
  }
  if (stats.safeties) {
    const points = stats.safeties * (scoring.safeties || 0);
    breakdown.safeties = points;
    total += points;
  }
  if (stats.blocked_kicks) {
    const points = stats.blocked_kicks * (scoring.blocked_kicks || 0);
    breakdown.blocked_kicks = points;
    total += points;
  }

  // Misc
  if (stats.fumbles_lost) {
    const points = stats.fumbles_lost * (scoring.fumbles_lost || 0);
    breakdown.fumbles_lost = points;
    total += points;
  }

  // Points allowed (DST)
  if (stats.points_allowed !== undefined) {
    let paPoints = 0;
    if (stats.points_allowed === 0) paPoints = scoring.points_allowed_0 || 10;
    else if (stats.points_allowed <= 6) paPoints = scoring.points_allowed_1_6 || 7;
    else if (stats.points_allowed <= 13) paPoints = scoring.points_allowed_7_13 || 4;
    else if (stats.points_allowed <= 20) paPoints = scoring.points_allowed_14_20 || 1;
    else if (stats.points_allowed <= 27) paPoints = scoring.points_allowed_21_27 || 0;
    else if (stats.points_allowed <= 34) paPoints = scoring.points_allowed_28_34 || -1;
    else paPoints = scoring.points_allowed_35_plus || -4;
    
    breakdown.points_allowed = paPoints;
    total += paPoints;
  }

  // Yards allowed (DST)
  if (stats.yards_allowed !== undefined) {
    let yaPoints = 0;
    if (stats.yards_allowed < 100) yaPoints = scoring.yards_allowed_0_99 || 10;
    else if (stats.yards_allowed < 200) yaPoints = scoring.yards_allowed_100_199 || 7;
    else if (stats.yards_allowed < 300) yaPoints = scoring.yards_allowed_200_299 || 4;
    else if (stats.yards_allowed < 400) yaPoints = scoring.yards_allowed_300_399 || 1;
    else if (stats.yards_allowed < 500) yaPoints = scoring.yards_allowed_400_499 || 0;
    else yaPoints = scoring.yards_allowed_500_plus || -4;
    
    breakdown.yards_allowed = yaPoints;
    total += yaPoints;
  }

  return { total: Math.round(total * 100) / 100, breakdown };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const url = new URL(req.url);
    const week = url.searchParams.get('week');
    const season = url.searchParams.get('season') || '2024';
    const leagueId = url.searchParams.get('leagueId');
    const playerIds = url.searchParams.get('playerIds')?.split(',');

    console.log('Fetching player data:', { week, season, leagueId, playerIds });

    // Get league scoring settings if leagueId provided
    let scoringSettings = DEFAULT_SCORING;
    if (leagueId) {
      const { data: league } = await supabase
        .from('connected_leagues')
        .select('scoring_settings, scoring_type')
        .eq('id', leagueId)
        .eq('user_id', user.id)
        .single();

      if (league?.scoring_settings) {
        scoringSettings = { ...DEFAULT_SCORING, ...league.scoring_settings };
      } else if (league?.scoring_type === 'standard') {
        scoringSettings = { ...DEFAULT_SCORING, receptions: 0 };
      } else if (league?.scoring_type === 'half_ppr') {
        scoringSettings = { ...DEFAULT_SCORING, receptions: 0.5 };
      }
    }

    // Build query for player stats
    let query = supabase
      .from('player_stats')
      .select('*')
      .eq('season', season);

    if (week) {
      query = query.eq('week', week);
    }

    if (playerIds && playerIds.length > 0) {
      query = query.in('player_id', playerIds);
    }

    const { data: stats, error: statsError } = await query;

    if (statsError) {
      console.error('Error fetching stats:', statsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch player stats' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate fantasy points for each player
    const playersWithPoints = stats.map(player => {
      const { total, breakdown } = calculateFantasyPoints(player, scoringSettings);
      
      return {
        player_id: player.player_id,
        player_name: player.player_name,
        team: player.team,
        position: player.position,
        week: player.week,
        season: player.season,
        stats: {
          passing_yards: player.passing_yards,
          passing_tds: player.passing_tds,
          interceptions: player.interceptions,
          rushing_yards: player.rushing_yards,
          rushing_tds: player.rushing_tds,
          receptions: player.receptions,
          receiving_yards: player.receiving_yards,
          receiving_tds: player.receiving_tds,
          // Include all other stats...
        },
        fantasy_points: total,
        points_breakdown: breakdown,
        source: player.source,
        last_updated: player.updated_at,
      };
    });

    return new Response(
      JSON.stringify({
        players: playersWithPoints,
        scoring_settings: scoringSettings,
        total_players: playersWithPoints.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in get-player-data:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});