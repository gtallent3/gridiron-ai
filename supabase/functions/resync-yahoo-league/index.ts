import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Fantasy points calculator
function calculateFantasyPoints(stats: any, scoring: any): number {
  let total = 0;
  
  // Passing
  if (stats.passing_yards && scoring.passing_yards) total += stats.passing_yards * scoring.passing_yards;
  if (stats.passing_tds && scoring.passing_tds) total += stats.passing_tds * scoring.passing_tds;
  if (stats.passing_ints && scoring.interceptions) total += stats.passing_ints * scoring.interceptions;
  
  // Rushing
  if (stats.rushing_yards && scoring.rushing_yards) total += stats.rushing_yards * scoring.rushing_yards;
  if (stats.rushing_tds && scoring.rushing_tds) total += stats.rushing_tds * scoring.rushing_tds;
  
  // Receiving
  if (stats.receptions && scoring.receptions) total += stats.receptions * scoring.receptions;
  if (stats.receiving_yards && scoring.receiving_yards) total += stats.receiving_yards * scoring.receiving_yards;
  if (stats.receiving_tds && scoring.receiving_tds) total += stats.receiving_tds * scoring.receiving_tds;
  
  return Math.round(total * 100) / 100;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Check for authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header provided' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create client with user's auth
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Admin client for credential access
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user authentication
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      console.error('Auth error:', authError);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { leagueId } = await req.json();
    console.log(`Resyncing Yahoo league: ${leagueId} for user ${user.id}`);

    // Calculate actual current NFL week based on 2024 season
    // 2024 NFL Season started September 5, 2024
    function getCurrentNFLWeek(): number {
      const now = new Date();
      const seasonStart = new Date('2024-09-05T00:00:00-04:00'); // NFL Week 1 start
      if (now < seasonStart) return 1;
      const daysSinceStart = Math.floor((now.getTime() - seasonStart.getTime()) / (1000 * 60 * 60 * 24));
      const weeksSinceStart = Math.floor(daysSinceStart / 7);
      return Math.min(weeksSinceStart + 1, 18);
    }

    // Get league details
    const { data: league, error: leagueError } = await supabase
      .from('connected_leagues')
      .select('*')
      .eq('id', leagueId)
      .eq('user_id', user.id)
      .eq('platform', 'yahoo')
      .single();

    if (leagueError || !league) {
      return new Response(JSON.stringify({ error: 'League not found or not authorized' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Update league's current week to actual NFL week if it's behind
    const actualWeek = getCurrentNFLWeek();
    if (!league.current_week || league.current_week < actualWeek) {
      await supabase
        .from('connected_leagues')
        .update({ current_week: actualWeek })
        .eq('id', leagueId);
      
      league.current_week = actualWeek;
      console.log(`Updated league current week to ${actualWeek}`);
    }

    // Get OAuth credentials from vault
    const { data: credentials, error: credsError } = await supabaseAdmin.rpc(
      'get_league_credentials',
      {
        p_user_id: user.id,
        p_platform: 'yahoo',
        p_league_id: league.league_id,
      }
    );

    if (credsError || !credentials) {
      console.error('Failed to get credentials:', credsError);
      return new Response(
        JSON.stringify({ error: 'OAuth credentials not found. Please reconnect your league.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let tokenData = credentials as { access_token: string; refresh_token: string };

    // Helper function to refresh Yahoo OAuth token
    async function refreshYahooToken(): Promise<void> {
      if (!user) throw new Error('User not authenticated');
      
      console.log('Refreshing Yahoo OAuth token...');
      const clientId = Deno.env.get('YAHOO_CLIENT_ID')!;
      const clientSecret = Deno.env.get('YAHOO_CLIENT_SECRET')!;
      
      const refreshResponse = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokenData.refresh_token,
        }),
      });

      if (!refreshResponse.ok) {
        const errorText = await refreshResponse.text();
        console.error('Token refresh failed:', errorText);
        throw new Error('Failed to refresh OAuth token. Please reconnect your Yahoo league.');
      }

      const refreshData = await refreshResponse.json();
      
      // Update token data with new access token (and possibly new refresh token)
      tokenData = {
        access_token: refreshData.access_token,
        refresh_token: refreshData.refresh_token || tokenData.refresh_token,
      };

      // Store updated tokens back in vault
      await supabaseAdmin.rpc('store_league_credentials', {
        p_user_id: user.id,
        p_platform: 'yahoo',
        p_league_id: league.league_id,
        p_credentials: tokenData,
      });

      console.log('Successfully refreshed Yahoo OAuth token');
    }

    // Helper function to make Yahoo API calls with automatic token refresh
    async function fetchYahooAPI(url: string): Promise<Response> {
      let response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      // If token expired, refresh and retry
      if (response.status === 401) {
        console.log('Access token expired, attempting refresh...');
        await refreshYahooToken();
        
        // Retry with new token
        response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            'Content-Type': 'application/json',
          },
        });
      }

      return response;
    }

    // Construct proper Yahoo league key format (e.g., "nfl.l.1582610")
    const rawLeagueId = String(league.league_id).trim();
    const yahooLeagueKey = /^nfl\.l\./.test(rawLeagueId)
      ? rawLeagueId
      : /^\d+$/.test(rawLeagueId)
        ? `nfl.l.${rawLeagueId}`
        : rawLeagueId; // fallback for already-full keys
    
    console.log(`Fetching teams for league (raw: ${rawLeagueId}) -> using key: ${yahooLeagueKey}`);
    const teamsResponse = await fetchYahooAPI(
      `https://fantasysports.yahooapis.com/fantasy/v2/league/${yahooLeagueKey}/teams?format=json`
    );

    if (!teamsResponse.ok) {
      const errorText = await teamsResponse.text();
      console.error('Yahoo API error:', {
        status: teamsResponse.status,
        statusText: teamsResponse.statusText,
        body: errorText,
        leagueId: league.league_id
      });
      
      throw new Error(`Failed to fetch teams from Yahoo: ${teamsResponse.statusText} - ${errorText}`);
    }

    const teamsData = await teamsResponse.json();
    const teams = teamsData.fantasy_content?.league?.[1]?.teams || {};
    
    // Collect all Yahoo player IDs to fetch canonical mappings
    const allYahooPlayerIds = new Set<string>();
    for (const [teamKey, teamValue] of Object.entries(teams)) {
      if (teamKey === 'count') continue;
      const team = (teamValue as any)?.team;
      if (!Array.isArray(team) || team.length === 0) continue;
      
      // Need to fetch roster first to get player IDs
      const teamData: Record<string, any> = {};
      for (const item of team[0]) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const [k, v] = Object.entries(item)[0] || [];
          if (k) teamData[k] = v;
        }
      }
      const numericTeamId = (teamData.team_id ?? (teamData.team_key?.split('.t.')[1]))?.toString();
      const rawTeamKey: string | undefined = teamData.team_key;
      const teamKeyFull = rawTeamKey || (numericTeamId ? `${yahooLeagueKey}.t.${numericTeamId}` : null);
      if (!teamKeyFull) continue;
      
      const weekParam = typeof league.current_week === 'number'
        ? `;type=week;week=${league.current_week}`
        : '';
      
      const rosterResponse = await fetchYahooAPI(
        `https://fantasysports.yahooapis.com/fantasy/v2/team/${teamKeyFull}/roster/players${weekParam}?format=json`
      );
      
      if (rosterResponse.ok) {
        const rosterData = await rosterResponse.json();
        const rosterPlayers = rosterData.fantasy_content?.team?.[1]?.roster?.['0']?.players || {};
        for (const [playerKey, playerValue] of Object.entries(rosterPlayers)) {
          if (playerKey === 'count') continue;
          const playerWrapper = (playerValue as any)?.player;
          if (!Array.isArray(playerWrapper) || playerWrapper.length === 0) continue;
          const core: Record<string, any> = {};
          for (const block of playerWrapper) {
            if (Array.isArray(block)) {
              for (const item of block) {
                if (item && typeof item === 'object' && !Array.isArray(item)) {
                  const [k, v] = Object.entries(item)[0] || [];
                  if (k) core[k] = v;
                }
              }
            } else if (block && typeof block === 'object') {
              Object.assign(core, block);
            }
          }
          if (core.player_id) {
            allYahooPlayerIds.add(String(core.player_id));
          }
        }
      }
    }
    
    // Build canonical player map using Yahoo IDs
    const canonicalMap = new Map<string, { id: string; player_name: string; position: string; team: string; sleeper_id: string | null; nfl_id: string | null }>();
    if (allYahooPlayerIds.size > 0) {
      const { data: canonicalPlayers } = await supabaseAdmin
        .from('canonical_players')
        .select('id, yahoo_id, sleeper_id, nfl_id, player_name, position, team')
        .in('yahoo_id', Array.from(allYahooPlayerIds));
      
      if (canonicalPlayers && canonicalPlayers.length > 0) {
        for (const p of canonicalPlayers) {
          if (p.yahoo_id) {
            canonicalMap.set(p.yahoo_id, {
              id: p.id,
              player_name: p.player_name,
              position: p.position,
              team: p.team,
              sleeper_id: p.sleeper_id,
              nfl_id: p.nfl_id,
            });
          }
        }
      }
    }
    
    // Also fetch all canonical players for name-based fallback matching
    const { data: allCanonicalPlayers } = await supabaseAdmin
      .from('canonical_players')
      .select('id, yahoo_id, sleeper_id, nfl_id, player_name, position, team');
    
    const canonicalByName = new Map<string, typeof allCanonicalPlayers>();
    if (allCanonicalPlayers) {
      for (const p of allCanonicalPlayers) {
        const normalizedName = p.player_name.toLowerCase().replace(/[^a-z]/g, '');
        if (!canonicalByName.has(normalizedName)) {
          canonicalByName.set(normalizedName, []);
        }
        canonicalByName.get(normalizedName)!.push(p);
      }
    }
    
    // Get all canonical player IDs for bulk stats fetch from player_pool_v2
    const canonicalIds = Array.from(new Set(Array.from(canonicalMap.values()).map(p => p.id)));
    
    // Fetch only projection rows to avoid Map key collisions
    const { data: projectionStats } = await supabase
      .from('player_pool_v2')
      .select('canonical_player_id, week, season, passing_yards, passing_tds, passing_attempts, passing_completions, passing_ints, passing_2pt_conversions, rushing_yards, rushing_tds, rushing_attempts, rushing_2pt_conversions, receptions, receiving_yards, receiving_tds, receiving_targets, receiving_2pt_conversions, fumbles_lost, projected_fp')
      .in('canonical_player_id', canonicalIds)
      .eq('season', 2025)
      .not('projected_fp', 'is', null);
    
    // Fetch only actual rows to avoid Map key collisions
    const { data: actualStatsData } = await supabase
      .from('player_pool_v2')
      .select('canonical_player_id, week, season, passing_yards, passing_tds, passing_attempts, passing_completions, passing_ints, passing_2pt_conversions, rushing_yards, rushing_tds, rushing_attempts, rushing_2pt_conversions, receptions, receiving_yards, receiving_tds, receiving_targets, receiving_2pt_conversions, fumbles_lost, actual_fp')
      .in('canonical_player_id', canonicalIds)
      .eq('season', 2025)
      .not('actual_fp', 'is', null);
    
    // Build separate maps
    const projectionMap = new Map((projectionStats || []).map(p => [`${p.canonical_player_id}_${p.week}`, p]));
    const actualMap = new Map((actualStatsData || []).map(p => [`${p.canonical_player_id}_${p.week}`, p]));
    console.log(`Loaded ${projectionStats?.length || 0} projections and ${actualStatsData?.length || 0} actuals from player_pool_v2`);
    
    let syncedCount = 0;

    // Sync each team's roster
    for (const [teamKey, teamValue] of Object.entries(teams)) {
      if (teamKey === 'count') continue;

      const team = (teamValue as any)?.team;
      if (!Array.isArray(team) || team.length === 0) continue;

      // Extract team info from nested structure
      const teamData: Record<string, any> = {};
      for (const item of team[0]) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const [k, v] = Object.entries(item)[0] || [];
          if (k) teamData[k] = v;
        }
      }

      const rawTeamKey: string | undefined = teamData.team_key;
      const numericTeamId = (teamData.team_id ?? (rawTeamKey?.split('.t.')[1]))?.toString();
      const teamKeyFull = rawTeamKey || (numericTeamId ? `${yahooLeagueKey}.t.${numericTeamId}` : null);
      
      const teamName = teamData.name || 'Unknown Team';

      if (!numericTeamId || !teamKeyFull) continue;

      // Fetch roster for this team with week parameter for accurate selected_position
      const weekParam = typeof league.current_week === 'number'
        ? `;type=week;week=${league.current_week}`
        : '';
      
      const rosterResponse = await fetchYahooAPI(
        `https://fantasysports.yahooapis.com/fantasy/v2/team/${teamKeyFull}/roster/players${weekParam}?format=json`
      );

      if (!rosterResponse.ok) {
        console.warn(`Failed to fetch roster for team ${teamName}`);
        continue;
      }

      const rosterData = await rosterResponse.json();
      const rosterPlayers = rosterData.fantasy_content?.team?.[1]?.roster?.['0']?.players || {};

      // Helper function to extract selected_position from various Yahoo nested structures
      function getSelectedPositionFromPlayerWrapper(playerWrapper: any): string | null {
        const tryExtract = (val: any): string | null => {
          if (!val) return null;
          
          if (typeof val === 'object' && 'position' in val && typeof val.position === 'string') {
            return val.position;
          }
          
          if (Array.isArray(val)) {
            for (const item of val) {
              const pos = tryExtract(item);
              if (pos) return pos;
            }
            return null;
          }
          
          return null;
        };

        const stack: any[] = Array.isArray(playerWrapper) ? [...playerWrapper] : [playerWrapper];
        
        while (stack.length) {
          const node = stack.pop();
          
          if (Array.isArray(node)) {
            for (const item of node) stack.push(item);
            continue;
          }
          
          if (node && typeof node === 'object') {
            if ('selected_position' in node) {
              const pos = tryExtract(node.selected_position);
              if (pos) return pos;
            }
            
            for (const v of Object.values(node)) stack.push(v);
          }
        }
        return null;
      }

      // Convert Yahoo roster to standard format with canonical player IDs
      const roster: any[] = [];
      for (const [playerKey, playerValue] of Object.entries(rosterPlayers)) {
        if (playerKey === 'count') continue;

        const playerWrapper = (playerValue as any)?.player;
        if (!Array.isArray(playerWrapper) || playerWrapper.length === 0) continue;

        const core: Record<string, any> = {};
        for (const block of playerWrapper) {
          if (Array.isArray(block)) {
            for (const item of block) {
              if (item && typeof item === 'object' && !Array.isArray(item)) {
                const [k, v] = Object.entries(item)[0] || [];
                if (k && k !== 'selected_position') core[k] = v;
              }
            }
          } else if (block && typeof block === 'object') {
            if (!('selected_position' in block)) Object.assign(core, block);
          }
        }

        const yahooId = String(core.player_id || '');
        let canonical = yahooId ? canonicalMap.get(yahooId) : null;
        
        // If no canonical player found by Yahoo ID, try name-based matching
        if (yahooId && !canonical) {
          const playerName = core.name?.full || core.name || '';
          const normalizedName = playerName.toLowerCase().replace(/[^a-z]/g, '');
          const matchesByName = canonicalByName.get(normalizedName) || [];
          
          const position = core.primary_position || core.display_position || '';
          const team = core.editorial_team_abbr || '';
          
          // Find best match by position and team
          let bestMatch = matchesByName.find(p => p.position === position && p.team === team);
          if (!bestMatch && matchesByName.length > 0) {
            bestMatch = matchesByName.find(p => p.position === position);
          }
          if (!bestMatch && matchesByName.length > 0) {
            bestMatch = matchesByName[0];
          }
          
          if (bestMatch && !bestMatch.yahoo_id) {
            // Update existing canonical player with Yahoo ID
            await supabaseAdmin
              .from('canonical_players')
              .update({ yahoo_id: yahooId })
              .eq('id', bestMatch.id);
            
            canonical = {
              id: bestMatch.id,
              player_name: bestMatch.player_name,
              position: bestMatch.position,
              team: bestMatch.team,
              sleeper_id: bestMatch.sleeper_id,
              nfl_id: bestMatch.nfl_id,
            };
            canonicalMap.set(yahooId, canonical);
            console.log(`Updated canonical player ${bestMatch.player_name} with Yahoo ID ${yahooId}`);
          } else if (!bestMatch) {
            // Create new canonical player
            const newPlayer = {
              yahoo_id: yahooId,
              player_name: playerName,
              position: position,
              team: team,
            };
            const { data: inserted } = await supabaseAdmin
              .from('canonical_players')
              .upsert([newPlayer], { onConflict: 'yahoo_id' })
              .select('id, yahoo_id, sleeper_id, nfl_id, player_name, position, team')
              .single();
            
            if (inserted) {
              canonical = {
                id: inserted.id,
                player_name: inserted.player_name,
                position: inserted.position,
                team: inserted.team,
                sleeper_id: inserted.sleeper_id,
                nfl_id: inserted.nfl_id,
              };
              canonicalMap.set(yahooId, canonical);
              console.log(`Created new canonical player ${inserted.player_name} with Yahoo ID ${yahooId}`);
            }
          }
        }

        let selectedPosition = getSelectedPositionFromPlayerWrapper(playerWrapper);
        
        // Normalize selected_position to uppercase for consistency
        if (selectedPosition) {
          selectedPosition = String(selectedPosition).toUpperCase().trim();
        }
        
        // If no selected_position found, use fallback
        if (!selectedPosition || selectedPosition === '') {
          selectedPosition = core.display_position
            ?? (Array.isArray(core.eligible_positions) ? core.eligible_positions[0] : null)
            ?? 'BN';
          if (selectedPosition) {
            selectedPosition = String(selectedPosition).toUpperCase().trim();
          }
        }
        
        console.log(`Player ${core.name?.full || core.name} - Position: ${selectedPosition}`);
        
        const updatedCanonical = canonical;
        
        // Calculate projected and actual points using league-specific scoring
        let projected = 0;
        let actual = 0;
        
        if (updatedCanonical) {
          const playerPosition = core.primary_position || core.display_position || '';
          
          // Get current week projection
          const projKey = `${updatedCanonical.id}_${league.current_week || 1}`;
          const projStats = projectionMap.get(projKey);
          if (projStats) {
            // For kickers, use projected_fp directly as raw stats don't apply
            if (playerPosition === 'K') {
              projected = projStats.projected_fp || 0;
            } else {
              projected = calculateFantasyPoints({
                passing_yards: projStats.passing_yards,
                passing_tds: projStats.passing_tds,
                passing_attempts: projStats.passing_attempts,
                passing_completions: projStats.passing_completions,
                interceptions: projStats.passing_ints,
                passing_2pt_conversions: projStats.passing_2pt_conversions,
                rushing_yards: projStats.rushing_yards,
                rushing_tds: projStats.rushing_tds,
                rushing_attempts: projStats.rushing_attempts,
                rushing_2pt_conversions: projStats.rushing_2pt_conversions,
                receptions: projStats.receptions,
                receiving_yards: projStats.receiving_yards,
                receiving_tds: projStats.receiving_tds,
                receiving_targets: projStats.receiving_targets,
                receiving_2pt_conversions: projStats.receiving_2pt_conversions,
                fumbles_lost: projStats.fumbles_lost,
              }, league.scoring_settings || {});
            }
          }
          
          // Get last week's actual
          if ((league.current_week || 1) > 1) {
            const actualKey = `${updatedCanonical.id}_${(league.current_week || 1) - 1}`;
            const actualStats = actualMap.get(actualKey);
            if (actualStats) {
              // For kickers, use actual_fp directly as raw stats don't apply
              if (playerPosition === 'K') {
                actual = actualStats.actual_fp || 0;
              } else {
                actual = calculateFantasyPoints({
                  passing_yards: actualStats.passing_yards,
                  passing_tds: actualStats.passing_tds,
                  passing_attempts: actualStats.passing_attempts,
                  passing_completions: actualStats.passing_completions,
                  interceptions: actualStats.passing_ints,
                  passing_2pt_conversions: actualStats.passing_2pt_conversions,
                  rushing_yards: actualStats.rushing_yards,
                  rushing_tds: actualStats.rushing_tds,
                  rushing_attempts: actualStats.rushing_attempts,
                  rushing_2pt_conversions: actualStats.rushing_2pt_conversions,
                  receptions: actualStats.receptions,
                  receiving_yards: actualStats.receiving_yards,
                  receiving_tds: actualStats.receiving_tds,
                  receiving_targets: actualStats.receiving_targets,
                  receiving_2pt_conversions: actualStats.receiving_2pt_conversions,
                  fumbles_lost: actualStats.fumbles_lost,
                }, league.scoring_settings || {});
              }
            }
          }
        }
        
        roster.push({
          player_id: yahooId,
          canonical_player_id: updatedCanonical?.id || null,
          yahoo_id: yahooId,
          sleeper_id: updatedCanonical?.sleeper_id || null,
          nfl_id: updatedCanonical?.nfl_id || null,
          player_name: updatedCanonical?.player_name || core.name?.full || core.name || '',
          position: updatedCanonical?.position || core.primary_position || core.display_position || '',
          team: updatedCanonical?.team || core.editorial_team_abbr || '',
          selected_position: selectedPosition,
          projected,
          actual,
        });
      }

      // Log starters vs bench for debugging
      const starters = roster.filter((p: any) => p.selected_position && p.selected_position !== 'BN').length;
      const bench = roster.length - starters;
      console.log(`Team ${teamName} (${numericTeamId}) starters=${starters} bench=${bench}`);

      // First, delete any existing records for this team to prevent duplicates (numeric and full keys)
      const altGameToNfl = (k: string) => k.replace(/^\d+\./, 'nfl.');
      const altNflToNumeric = (k: string) => k.replace(/^nfl\./, '461.');
      const candidateIds = Array.from(
        new Set(
          [numericTeamId, teamKeyFull, altGameToNfl(teamKeyFull), altNflToNumeric(teamKeyFull)].filter(Boolean) as string[]
        )
      );

      await supabaseAdmin
        .from('user_teams')
        .delete()
        .eq('league_id', leagueId)
        .in('team_id', candidateIds);

      // Then insert the new roster data with canonical team key
      await supabaseAdmin
        .from('user_teams')
        .insert({
          league_id: leagueId,
          team_id: teamKeyFull,
          team_name: teamName,
          roster: roster,
        });

      syncedCount++;
    }

    // Update last synced timestamp
    await supabase
      .from('connected_leagues')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', leagueId);

    console.log(`Successfully synced ${syncedCount} teams for league ${league.league_name}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Synced ${syncedCount} teams`,
        teamsSynced: syncedCount,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Resync error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to resync league' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
