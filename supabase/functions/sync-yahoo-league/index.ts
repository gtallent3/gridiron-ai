import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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

    // Fetch teams/rosters and user info
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
      return createErrorResponse('Failed to fetch league teams', 400, corsHeaders);
    }

    const teamsData = await teamsResponse.json();
    console.log('Successfully fetched teams');

    // Find user's team from the teams data
    const teams = teamsData.fantasy_content?.league?.[1]?.teams;
    let userTeamId = null;
    let userTeamName = null;

    if (teams && typeof teams === 'object') {
      for (const [key, value] of Object.entries(teams)) {
        if (key === 'count') continue;
        const team = (value as any)?.team?.[0];
        const isOwned = team?.is_owned_by_current_login === '1' || team?.is_owned_by_current_login === 1;
        if (isOwned) {
          userTeamId = team?.team_key || team?.team_id;
          userTeamName = team?.name;
          console.log('Found user team:', userTeamName, userTeamId);
          break;
        }
      }
    }

    if (!userTeamId) {
      console.warn('Could not find user team; proceeding without userTeamId');
    }

    // Store credentials securely using the existing function
    const credentialsResult = await supabaseAdmin.rpc('store_league_credentials', {
      p_user_id: user.id,
      p_platform: 'yahoo',
      p_league_id: leagueId,
      p_credentials: {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: tokenData.expires_at,
        league_key: leagueKey,
      },
    });

    if (credentialsResult.error) {
      console.error('Failed to store credentials:', credentialsResult.error);
      return createErrorResponse('Failed to store credentials', 500, corsHeaders);
    }

    console.log('Credentials stored successfully');

    // Insert or update connected_leagues record
    const { data: leagueRecord, error: leagueError } = await supabaseAdmin
      .from('connected_leagues')
      .upsert({
        user_id: user.id,
        platform: 'yahoo',
        league_id: leagueId,
        league_name: leagueName,
        user_team_id: userTeamId,
        scoring_type: 'standard',
        league_size: parseInt(league.num_teams || '0'),
        scoring_settings: {},
        auto_refresh: true,
        last_synced_at: new Date().toISOString(),
        current_week: parseInt(league.current_week || '1'),
      }, {
        onConflict: 'user_id,platform,league_id',
      })
      .select()
      .single();

    if (leagueError) {
      console.error('Failed to insert league:', leagueError);
      return createErrorResponse('Failed to save league', 500, corsHeaders);
    }

    console.log(`League ${leagueName} (${userTeamName}) synced successfully`);

    // Now fetch and store roster data for all teams
    if (teams && typeof teams === 'object') {
      for (const [key, value] of Object.entries(teams)) {
        if (key === 'count') continue;
        
        const team = (value as any)?.team?.[0];
        if (!team) continue;

        const teamId = team.team_key || team.team_id || '';
        const teamName = team.name || 'Unknown Team';
        
        console.log(`Fetching roster for team: ${teamName}`);

        // Fetch roster for this team
        try {
          const rosterResponse = await fetch(
            `https://fantasysports.yahooapis.com/fantasy/v2/team/${teamId}/roster?format=json`,
            {
              headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
              },
            }
          );

          if (!rosterResponse.ok) {
            console.warn(`Failed to fetch roster for team ${teamName}`);
            continue;
          }

          const rosterData = await rosterResponse.json();
          const rosterPlayers = rosterData.fantasy_content?.team?.[1]?.roster?.['0']?.players || {};
          
          // Convert Yahoo roster to standard format
          const roster: any[] = [];
          for (const [playerKey, playerValue] of Object.entries(rosterPlayers)) {
            if (playerKey === 'count') continue;
            const playerData = (playerValue as any)?.player?.[0];
            if (!playerData) continue;

            roster.push({
              player_id: playerData.player_id || '',
              player_name: playerData.name?.full || '',
              position: playerData.primary_position || playerData.display_position || '',
              team: playerData.editorial_team_abbr || '',
            });
          }

          // Store team in user_teams table
          await supabaseAdmin
            .from('user_teams')
            .upsert({
              league_id: leagueRecord.id,
              team_id: teamId,
              team_name: teamName,
              roster: roster,
              wins: parseInt(team.team_standings?.outcome_totals?.wins || '0'),
              losses: parseInt(team.team_standings?.outcome_totals?.losses || '0'),
              ties: parseInt(team.team_standings?.outcome_totals?.ties || '0'),
            }, {
              onConflict: 'league_id,team_id',
            });

          console.log(`Stored roster for ${teamName}: ${roster.length} players`);
        } catch (err) {
          console.error(`Error processing team ${teamName}:`, err);
        }
      }
    }

    console.log(`All teams synced for league ${leagueName}`);

    return new Response(
      JSON.stringify({
        success: true,
        league: {
          id: leagueRecord.id,
          name: leagueName,
          season,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in sync-yahoo-league:', error);
    return createErrorResponse(error, 500, corsHeaders);
  }
});
