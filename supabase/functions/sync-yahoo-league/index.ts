import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";
import { createErrorResponse } from "../_shared/errorHandler.ts";

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
    
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return createErrorResponse('Missing authorization header', 401, corsHeaders);
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      console.error('Auth error:', userError);
      return createErrorResponse('Unauthorized', 401, corsHeaders);
    }

    const { leagueKey, tokenData } = await req.json();

    if (!leagueKey || !tokenData) {
      return createErrorResponse('Missing leagueKey or tokenData', 400, corsHeaders);
    }

    console.log(`Syncing Yahoo league: ${leagueKey}`);

    // Fetch league details
    const leagueResponse = await fetch(
      `https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueKey}?format=json`,
      {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
        },
      }
    );

    if (!leagueResponse.ok) {
      console.error('Failed to fetch league details');
      return createErrorResponse('Failed to fetch Yahoo league details', 400, corsHeaders);
    }

    const leagueData = await leagueResponse.json();
    const league = leagueData.fantasy_content.league[0];
    
    const leagueName = league.name;
    const leagueId = leagueKey.split('.').pop(); // Extract numeric ID from key
    const season = league.season;

    console.log(`League: ${leagueName}, Season: ${season}`);

    // Calculate actual current NFL week based on season dates
    // 2025 NFL Season started September 4, 2025
    // Week 1: Sep 4-10, Week 2: Sep 11-17, etc.
    function getCurrentNFLWeek(): number {
      const now = new Date();
      const seasonStart = new Date('2025-09-04T00:00:00-04:00'); // NFL Week 1 start
      
      // If before season start, return 1
      if (now < seasonStart) return 1;
      
      // Calculate weeks since season start
      const daysSinceStart = Math.floor((now.getTime() - seasonStart.getTime()) / (1000 * 60 * 60 * 24));
      const weeksSinceStart = Math.floor(daysSinceStart / 7);
      
      // Add 1 to get current week (week 1 is first week)
      const calculatedWeek = weeksSinceStart + 1;
      
      // Cap at week 18 (regular season end)
      return Math.min(calculatedWeek, 18);
    }

    const calculatedWeek = getCurrentNFLWeek();
    const yahooWeek = parseInt(league.current_week || '1');
    
    // Use the higher of calculated week or Yahoo's week (in case Yahoo is behind)
    const currentWeek = Math.max(calculatedWeek, yahooWeek);
    
    console.log(`Yahoo reported week: ${yahooWeek}, Calculated week: ${calculatedWeek}, Using week: ${currentWeek}`);

    // Fetch scoring settings
    const settingsResponse = await fetch(
      `https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueKey}/settings?format=json`,
      {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
        },
      }
    );

    if (!settingsResponse.ok) {
      console.error('Failed to fetch league settings');
      return createErrorResponse('Failed to fetch Yahoo league settings', 400, corsHeaders);
    }

    const settingsData = await settingsResponse.json();
		const scoringSettings = settingsData.fantasy_content.league[0].settings[0].stat_categories.stats.map((stat: any) => {
			return {
				stat_id: stat.stat.stat_id,
				name: stat.stat.name,
				abbr: stat.stat.abbr,
				value: stat.stat.value
			}
		});

    // Fetch teams
    const teamsResponse = await fetch(
      `https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueKey}/teams?format=json`,
      {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
        },
      }
    );

    if (!teamsResponse.ok) {
      console.error('Failed to fetch teams');
      return createErrorResponse('Failed to fetch Yahoo teams', 400, corsHeaders);
    }

    const teamsData = await teamsResponse.json();
    const teams = teamsData.fantasy_content.league[0].teams[0].team;

    // Process each team
    for (const team of teams) {
      const teamId = team[0].team_id;
      const teamName = team[2].name;

      console.log(`Team: ${teamName} (${teamId})`);

      // Fetch roster for the current week
      const rosterResponse = await fetch(
        `https://fantasysports.yahooapis.com/fantasy/v2/team/${leagueKey}.t.${teamId}/roster;week=${currentWeek}?format=json`,
        {
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
          },
        }
      );

      if (!rosterResponse.ok) {
        console.error(`Failed to fetch roster for team ${teamId}`);
        continue; // Skip to next team
      }

      const rosterData = await rosterResponse.json();
      const players = rosterData.fantasy_content.team[0].roster[0].players[0].player;

      // Process each player in the roster
      for (const player of players) {
        const playerKey = player[0].player_key;
        const playerId = player[0].player_id;
        const playerName = player[2].name.full;
        const playerPosition = player[7].display_position;
				const playerImageUrl = player[6].image_url;

        console.log(`  Player: ${playerName} (${playerId}), Position: ${playerPosition}`);

        // Fetch player stats for the current week
        const playerStatsResponse = await fetch(
          `https://fantasysports.yahooapis.com/fantasy/v2/player/${playerKey}/stats;type=week;week=${currentWeek}?format=json`,
          {
            headers: {
              'Authorization': `Bearer ${tokenData.access_token}`,
            },
          }
        );

        if (!playerStatsResponse.ok) {
          console.warn(`  Failed to fetch stats for player ${playerId}`);
          continue; // Skip to next player
        }

        const playerStatsData = await playerStatsResponse.json();
        const playerStats = playerStatsData.fantasy_content.player[0].player_stats[0].stats;

				// Convert stats array to object
				const statsObject: { [key: string]: number | null } = {};
				playerStats.forEach((stat: any) => {
					if (stat.stat) {
						const statId = stat.stat.stat_id;
						const value = stat.stat.value;
						statsObject[statId] = value === '-' ? null : parseFloat(value);
					}
				});

				// Calculate fantasy points
				let fantasyPoints = 0;
				if (Object.keys(statsObject).length > 0) {
					fantasyPoints = calculateFantasyPoints(statsObject, scoringSettings);
				}

        // Store player data and stats in Supabase
        const { error: upsertError } = await supabaseAdmin
          .from('player_stats')
          .upsert({
            player_id: playerId,
            player_name: playerName,
						player_image_url: playerImageUrl,
            team_id: teamId,
            team_name: teamName,
            league_id: leagueId,
            league_name: leagueName,
            platform: 'yahoo',
            season: season,
            week: currentWeek,
            year: new Date().getFullYear(), // Use current year for simplicity
            stats: statsObject,
            position: playerPosition,
            fantasy_points: fantasyPoints,
            user_id: user.id,
            finalized: false,
          }, { onConflict: 'player_id, league_id, week, season' });

        if (upsertError) {
          console.error('  Upsert error:', upsertError);
        } else {
          console.log(`  Upserted stats for player ${playerName}`);
        }
      }
    }

    // Store Yahoo credentials securely
    const { error: credentialError } = await supabaseAdmin
      .from('credentials')
      .upsert({
        user_id: user.id,
        platform: 'yahoo',
        data: tokenData,
      }, { onConflict: 'user_id, platform' });

    if (credentialError) {
      console.error('Credential store error:', credentialError);
      return createErrorResponse('Failed to store Yahoo credentials', 500, corsHeaders);
    }

    return new Response(
      JSON.stringify({ message: `Yahoo league synced successfully for week ${currentWeek}` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Sync error:', error);
    return createErrorResponse(error.message || 'Internal server error', 500, corsHeaders);
  }
});

// Fantasy points calculator
function calculateFantasyPoints(stats: any, scoring: any): number {
  let total = 0;
  
  // Passing
  const passingYardsStat = scoring.find((s: any) => s.abbr === 'Pass Yds');
  if (stats[passingYardsStat?.stat_id] && passingYardsStat?.value) total += stats[passingYardsStat?.stat_id] * passingYardsStat?.value;

  const passingTDsStat = scoring.find((s: any) => s.abbr === 'Pass TD');
  if (stats[passingTDsStat?.stat_id] && passingTDsStat?.value) total += stats[passingTDsStat?.stat_id] * passingTDsStat?.value;

  const passingIntsStat = scoring.find((s: any) => s.abbr === 'INT');
  if (stats[passingIntsStat?.stat_id] && passingIntsStat?.value) total += stats[passingIntsStat?.stat_id] * passingIntsStat?.value;
  
  // Rushing
  const rushingYardsStat = scoring.find((s: any) => s.abbr === 'Rush Yds');
  if (stats[rushingYardsStat?.stat_id] && rushingYardsStat?.value) total += stats[rushingYardsStat?.stat_id] * rushingYardsStat?.value;

  const rushingTDsStat = scoring.find((s: any) => s.abbr === 'Rush TD');
  if (stats[rushingTDsStat?.stat_id] && rushingTDsStat?.value) total += stats[rushingTDsStat?.stat_id] * rushingTDsStat?.value;
  
  // Receiving
  const receptionsStat = scoring.find((s: any) => s.abbr === 'Rec');
  if (stats[receptionsStat?.stat_id] && receptionsStat?.value) total += stats[receptionsStat?.stat_id] * receptionsStat?.value;

  const receivingYardsStat = scoring.find((s: any) => s.abbr === 'Rec Yds');
  if (stats[receivingYardsStat?.stat_id] && receivingYardsStat?.value) total += stats[receivingYardsStat?.stat_id] * receivingYardsStat?.value;

  const receivingTDsStat = scoring.find((s: any) => s.abbr === 'Rec TD');
  if (stats[receivingTDsStat?.stat_id] && receivingTDsStat?.value) total += stats[receivingTDsStat?.stat_id] * receivingTDsStat?.value;
  
  return Math.round(total * 100) / 100;
}
