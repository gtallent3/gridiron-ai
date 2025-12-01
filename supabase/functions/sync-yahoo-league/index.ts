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
    // 2024 NFL Season started September 5, 2024
    // Week 1: Sep 5-9, Week 2: Sep 12-16, etc.
    function getCurrentNFLWeek(): number {
      const now = new Date();
      const seasonStart = new Date('2024-09-05T00:00:00Z'); // NFL Week 1 start
      
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
    // Prepare scoring and opponent details
    let scoringSettings: any = {};
    let scoringType = 'standard';
    let opponentTeamId: string | null = null;
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
    let userGuid: string | null = null;

    // Get the authenticated user's GUID first
    try {
      const userGuidResp = await fetch(
        `https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1?format=json`,
        {
          headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
        }
      );
      if (userGuidResp.ok) {
        const guidData = await userGuidResp.json();
        userGuid = guidData?.fantasy_content?.users?.[0]?.user?.[0]?.guid;
        console.log('User GUID:', userGuid);
      }
    } catch (e) {
      console.warn('Error fetching user GUID:', e);
    }

    // Method 1: Try to find user's team via the user teams endpoint
    try {
      const userTeamsResp = await fetch(
        `https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/teams?format=json`,
        {
          headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
        }
      );
      if (userTeamsResp.ok) {
        const userTeamsData = await userTeamsResp.json();
        console.log('User teams response:', JSON.stringify(userTeamsData, null, 2));
        
        const usersObj = userTeamsData?.fantasy_content?.users;
        const userObj = usersObj?.[0]?.user?.[1];
        const userTeams = userObj?.teams;
        if (userTeams && typeof userTeams === 'object') {
          for (const [k, v] of Object.entries(userTeams)) {
            if (k === 'count') continue;
            const teamArr = (v as any)?.team;
            
            // Yahoo returns team as [[{obj1}, {obj2}, ...]] - double nested
            if (Array.isArray(teamArr) && teamArr.length > 0) {
              const innerArr = teamArr[0]; // Get the inner array
              if (Array.isArray(innerArr)) {
                // Flatten the array of single-property objects
                const flat: Record<string, any> = {};
                for (const item of innerArr) {
                  if (item && typeof item === 'object' && !Array.isArray(item)) {
                    const [key, val] = Object.entries(item)[0] || [];
                    if (key) flat[key] = val;
                  }
                }
                
                const tKey: string | undefined = flat['team_key'] as string | undefined;
                const tName: string | undefined = flat['name'] as string;
                
                console.log(`Checking team: ${tName} (${tKey}) for league ${leagueKey}`);
                
                if (tKey && tKey.startsWith(`${leagueKey}.t.`)) {
                  userTeamId = tKey;
                  userTeamName = tName || null;
                  console.log('✓ Method 1: Resolved user team via users endpoint:', userTeamName, userTeamId);
                  break;
                }
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

    // Method 2: Check for is_owned_by_current_login flag in league teams
    if (!userTeamId && teams && typeof teams === 'object') {
      console.log('Trying Method 2: is_owned_by_current_login flag');
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
          console.log(`Team ${flat['name']}: is_owned=${flat['is_owned_by_current_login']}`);
          if (flat['is_owned_by_current_login'] === 1 || flat['is_owned_by_current_login'] === '1') {
            userTeamId = flat['team_key'] || flat['team_id'];
            userTeamName = (flat['name'] as any)?.full || flat['name'] || null;
            console.log('✓ Method 2: Found user team via ownership flag:', userTeamName, userTeamId);
            break;
          }
        }
      }
    }

    // Method 3: Match by manager GUID if available
    if (!userTeamId && userGuid && teams && typeof teams === 'object') {
      console.log('Trying Method 3: Matching by manager GUID');
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
          
          // Check if any manager has matching GUID
          const managers = flat['managers'];
          if (managers && Array.isArray(managers)) {
            for (const mgr of managers) {
              const managerData = mgr?.manager;
              if (managerData?.guid === userGuid) {
                userTeamId = flat['team_key'] || flat['team_id'];
                userTeamName = (flat['name'] as any)?.full || flat['name'] || null;
                console.log('✓ Method 3: Found user team via GUID match:', userTeamName, userTeamId);
                break;
              }
            }
          }
          if (userTeamId) break;
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
        
        // Yahoo returns team as [[{obj1}, {obj2}, ...]] - double nested
        const teamWrapper = (value as any)?.team;
        if (!Array.isArray(teamWrapper) || teamWrapper.length === 0) continue;
        
        const teamArr = teamWrapper[0]; // Get inner array
        if (!Array.isArray(teamArr)) continue;
        
        // Flatten the array of single-property objects
        const team: Record<string, any> = {};
        for (const item of teamArr) {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            const [k, v] = Object.entries(item)[0] || [];
            if (k) team[k] = v;
          }
        }

        const teamId = team.team_key || team.team_id || '';
        const teamName = team.name || 'Unknown Team';
        
        console.log(`Fetching roster for team: ${teamName} (${teamId})`);

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
            
            // Yahoo returns player data in multiple nested blocks; merge them and extract selected_position
            const playerWrapper = (playerValue as any)?.player;
            if (!Array.isArray(playerWrapper) || playerWrapper.length === 0) continue;

            const core: Record<string, any> = {};
            let selectedPosition: string | null = null;

            for (const block of playerWrapper) {
              if (Array.isArray(block)) {
                for (const item of block) {
                  if (item && typeof item === 'object' && !Array.isArray(item)) {
                    const [k, v] = Object.entries(item)[0] || [];
                    if (!k) continue;
                    if (k === 'selected_position') {
                      if (typeof v === 'string') {
                        selectedPosition = v;
                      } else if (v && typeof v === 'object') {
                        const pos = (v as any).position ?? (Array.isArray(v) ? (v as any)[0]?.position : undefined);
                        if (typeof pos === 'string') selectedPosition = pos;
                      }
                    } else {
                      core[k] = v;
                    }
                  }
                }
              } else if (block && typeof block === 'object') {
                if ('selected_position' in (block as any)) {
                  const v: any = (block as any).selected_position;
                  if (typeof v === 'string') {
                    selectedPosition = v;
                  } else if (v && typeof v === 'object') {
                    const pos = v.position ?? (Array.isArray(v) ? v[0]?.position : undefined);
                    if (typeof pos === 'string') selectedPosition = pos;
                  }
                } else {
                  Object.assign(core, block);
                }
              }
            }

            // Normalize selected_position to uppercase for consistency
            const normalizedSelectedPosition = selectedPosition ? String(selectedPosition).toUpperCase().trim() : 'BN';

            roster.push({
              player_id: core.player_id || '',
              player_name: core.name?.full || core.name || '',
              position: core.primary_position || core.display_position || '',
              team: core.editorial_team_abbr || '',
              selected_position: normalizedSelectedPosition,
            });
          }

          // Store team in user_teams table - delete existing first to prevent duplicates
          await supabaseAdmin
            .from('user_teams')
            .delete()
            .eq('league_id', leagueRecord.id)
            .eq('team_id', teamId);

          await supabaseAdmin
            .from('user_teams')
            .insert({
              league_id: leagueRecord.id,
              team_id: teamId,
              team_name: teamName,
              roster: roster,
              wins: parseInt(team.team_standings?.outcome_totals?.wins || '0'),
              losses: parseInt(team.team_standings?.outcome_totals?.losses || '0'),
              ties: parseInt(team.team_standings?.outcome_totals?.ties || '0'),
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
