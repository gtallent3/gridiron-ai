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

const POSITION_MAP: Record<number, string> = {
  1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF'
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

    // Get league from database to find user's team ID
    const { data: league, error: leagueError } = await supabase
      .from('connected_leagues')
      .select('league_id, user_team_id')
      .eq('id', leagueId)
      .eq('user_id', user.id)
      .single();

    if (leagueError || !league) {
      throw new Error('League not found');
    }

    const espnLeagueId = league.league_id;
    const userTeamId = league.user_team_id;

    // Get stored credentials from espn_credentials table
    const { data: credentials, error: credError } = await supabase
      .from('espn_credentials')
      .select('swid_encrypted, espn_s2_encrypted, expires_at')
      .eq('user_id', user.id)
      .eq('league_id', espnLeagueId)
      .maybeSingle();

    if (credError) {
      console.error('Error fetching credentials:', credError);
      throw new Error('Failed to retrieve credentials');
    }

    if (!credentials) {
      throw new Error('No credentials found for this league');
    }

    // Check if credentials are expired
    if (credentials.expires_at && new Date(credentials.expires_at) < new Date()) {
      throw new Error('Credentials have expired. Please reconnect your league.');
    }

    const espn_s2 = credentials.espn_s2_encrypted;
    const swid = credentials.swid_encrypted;

    const now = new Date();
    const currentSeason = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;

    // Fetch user's team roster for specific week
    const teamUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${currentSeason}/segments/0/leagues/${espnLeagueId}?scoringPeriodId=${week}&view=mRoster&view=mTeam`;
    
    console.log(`Fetching team roster for week ${week}, team ${userTeamId}...`);
    
    const teamResponse = await fetch(teamUrl, {
      headers: { 'Cookie': `espn_s2=${espn_s2}; SWID=${swid}` }
    });

    if (!teamResponse.ok) {
      throw new Error(`Failed to fetch team data: ${teamResponse.status}`);
    }

    const teamData = await teamResponse.json();
    const teams = teamData.teams || [];
    const userTeam = teams.find((t: any) => String(t.id) === String(userTeamId));

    if (!userTeam) {
      throw new Error('User team not found');
    }

    // Get roster entries for the specific week
    const rosterEntry = userTeam.roster?.entries || [];
    
    console.log(`Found ${rosterEntry.length} players in roster for week ${week}`);

    const players: any[] = [];

    for (const entry of rosterEntry) {
      const player = entry.playerPoolEntry?.player;
      if (!player) continue;

      const playerId = String(player.id);
      const fullName = player.fullName;
      const position = player.defaultPositionId;
      const positionName = POSITION_MAP[position] || 'FLEX';
      const proTeamId = player.proTeamId;
      const team = getTeamAbbreviation(proTeamId);
      const lineupSlot = entry.lineupSlotId;

      // Get injury status
      const injuryStatus = player.injuryStatus;
      const injuryMap: Record<string, string | null> = {
        'ACTIVE': null,
        'QUESTIONABLE': 'Questionable',
        'DOUBTFUL': 'Doubtful',
        'OUT': 'Out',
        'INJURY_RESERVE': 'IR',
        'PHYSICALLY_UNABLE_TO_PERFORM': 'PUP'
      };

      // Find actual stats for this specific week (statSourceId: 0 = actual, 1 = projected)
      const weekStats = player.stats?.find((s: any) => s.scoringPeriodId === week && s.statSourceId === 0);
      const projectedStats = player.stats?.find((s: any) => s.scoringPeriodId === week && s.statSourceId === 1);
      
      let actualPoints = 0;
      let projectedPoints = 0;
      let isByeWeek = false;

      // Use ESPN's applied total for actual points (this is already calculated with league settings)
      if (weekStats && typeof weekStats.appliedTotal === 'number') {
        actualPoints = weekStats.appliedTotal;
      } else if (!weekStats) {
        isByeWeek = true;
      }

      // Use projected applied total for projections
      if (projectedStats && typeof projectedStats.appliedTotal === 'number') {
        projectedPoints = projectedStats.appliedTotal;
      }

      players.push({
        player_id: playerId,
        player_name: fullName,
        position: positionName,
        team: team,
        slot: lineupSlot,
        actual_points: Math.round(actualPoints * 100) / 100,
        projected_points: Math.round(projectedPoints * 100) / 100,
        is_bye_week: isByeWeek,
        injury_status: injuryMap[injuryStatus] || null
      });
    }

    console.log(`Returning ${players.length} players with scores for week ${week}`);

    return new Response(
      JSON.stringify({
        success: true,
        week: week,
        season: currentSeason,
        players: players
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Get week scores error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
