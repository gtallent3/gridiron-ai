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

    // Prepare scoring and opponent details
    let scoringSettings: any = {};
    let scoringType = 'standard';
    let opponentTeamId: string | null = null;

    const currentWeek = parseInt(league.current_week || '1');

    // Fetch league settings to populate scoring_settings and try to infer scoring_type
    try {
      const settingsResponse = await fetch(
        `https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueKey}/settings?format=json`,
        {
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
          },
        }
      );
      if (settingsResponse.ok) {
        const settingsData = await settingsResponse.json();
        scoringSettings = settingsData?.fantasy_content?.league?.[1]?.settings || {};
        // Best-effort: detect PPR from stat modifiers by looking for a Receptions entry
        const mods = scoringSettings?.stat_modifiers?.stats;
        if (mods && typeof mods === 'object') {
          for (const [, val] of Object.entries(mods)) {
            const stat = (val as any)?.stat || {};
            const name: string = (stat.name || stat.display_name || '').toString();
            const v = parseFloat((val as any)?.value ?? (stat as any)?.value ?? 'NaN');
            if (/reception/i.test(name) && !Number.isNaN(v)) {
              if (v === 1) scoringType = 'ppr';
              else if (v === 0.5) scoringType = 'half_ppr';
              else if (v > 0) scoringType = 'custom';
              break;
            }
          }
        }
      } else {
        console.warn('Failed to fetch league settings');
      }
    } catch (err) {
      console.warn('Error fetching league settings:', err);
    }

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

    // Find user's team via the user teams endpoint (more reliable than team flags)
    const teams = teamsData.fantasy_content?.league?.[1]?.teams;
    let userTeamId: string | null = null;
    let userTeamName: string | null = null;

    try {
      const userTeamsResp = await fetch(
        `https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/teams?format=json`,
        {
          headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
        }
      );
      if (userTeamsResp.ok) {
        const userTeamsData = await userTeamsResp.json();
        const usersObj = userTeamsData?.fantasy_content?.users;
        const userObj = usersObj?.[0]?.user?.[1];
        const userTeams = userObj?.teams;
        if (userTeams && typeof userTeams === 'object') {
          for (const [k, v] of Object.entries(userTeams)) {
            if (k === 'count') continue;
            const teamArr = (v as any)?.team;
            if (Array.isArray(teamArr)) {
              // Flatten Yahoo team array of single-key objects
              const flat: Record<string, any> = {};
              for (const item of teamArr) {
                if (item && typeof item === 'object' && !Array.isArray(item)) {
                  const [key, val] = Object.entries(item)[0] || [];
                  if (key) flat[key] = val;
                }
              }
              const tKey: string | undefined = flat['team_key'] as string | undefined;
              const tName: string | undefined = (flat['name'] as any)?.full || flat['name'];
              if (tKey && tKey.startsWith(`${leagueKey}.t.`)) {
                userTeamId = tKey;
                userTeamName = typeof tName === 'string' ? tName : null;
                console.log('Resolved user team via users endpoint:', userTeamName, userTeamId);
                break;
              }
            }
          }
        }
      } else {
        console.warn('Failed to fetch user teams');
      }
    } catch (e) {
      console.warn('Error fetching user teams:', e);
    }

    if (!userTeamId && teams && typeof teams === 'object') {
      // Fallback: try to infer from league teams
      for (const [key, value] of Object.entries(teams)) {
        if (key === 'count') continue;
        const teamObj = (value as any)?.team;
        if (Array.isArray(teamObj)) {
          const flat: Record<string, any> = {};
          for (const item of teamObj) {
            if (item && typeof item === 'object' && !Array.isArray(item)) {
              const [k2, v2] = Object.entries(item)[0] || [];
              if (k2) flat[k2] = v2;
            }
          }
          if (flat['is_owned_by_current_login'] === 1 || flat['is_owned_by_current_login'] === '1') {
            userTeamId = flat['team_key'] || flat['team_id'];
            userTeamName = (flat['name'] as any)?.full || flat['name'] || null;
            break;
          }
        }
      }
    }

    // Try to resolve current opponent from scoreboard
    try {
      const scoreboardResp = await fetch(
        `https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueKey}/scoreboard;week=${currentWeek}?format=json`,
        { headers: { 'Authorization': `Bearer ${tokenData.access_token}` } }
      );
      if (scoreboardResp.ok && userTeamId) {
        const sb = await scoreboardResp.json();
        const matchups = sb?.fantasy_content?.league?.[1]?.scoreboard?.['0']?.matchups;
        if (matchups && typeof matchups === 'object') {
          for (const [mk, mv] of Object.entries(matchups)) {
            if (mk === 'count') continue;
            const matchup = (mv as any)?.matchup;
            const teamsContainer = Array.isArray(matchup) ? matchup.find((x: any) => x?.teams) : null;
            const teamsObj = teamsContainer?.teams;
            if (teamsObj && typeof teamsObj === 'object') {
              const pair: string[] = [];
              for (const [tk, tv] of Object.entries(teamsObj)) {
                if (tk === 'count') continue;
                const tArr = (tv as any)?.team;
                if (Array.isArray(tArr)) {
                  const flat: Record<string, any> = {};
                  for (const item of tArr) {
                    if (item && typeof item === 'object') {
                      const [fk, fv] = Object.entries(item)[0] || [];
                      if (fk) flat[fk] = fv;
                    }
                  }
                  if (flat['team_key']) pair.push(flat['team_key']);
                }
              }
              if (pair.includes(userTeamId) && pair.length === 2) {
                opponentTeamId = pair.find((t) => t !== userTeamId) || null;
                break;
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('Error fetching scoreboard/opponent:', e);
    }

    if (!userTeamId) {
      console.warn('Could not resolve user team; proceeding without userTeamId');
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
        scoring_type: scoringType,
        league_size: parseInt(league.num_teams || '0'),
        scoring_settings: scoringSettings || {},
        auto_refresh: true,
        last_synced_at: new Date().toISOString(),
        current_week: currentWeek,
        opponent_team_id: opponentTeamId,
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
