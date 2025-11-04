import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Create client with user's auth
    const authHeader = req.headers.get('Authorization')!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Admin client for credential access
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { leagueId } = await req.json();
    console.log(`Resyncing Yahoo league: ${leagueId} for user ${user.id}`);

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

    const tokenData = credentials as { access_token: string; refresh_token: string };

    // Construct proper Yahoo league key format (e.g., "nfl.l.1582610")
    const rawLeagueId = String(league.league_id).trim();
    const yahooLeagueKey = /^nfl\.l\./.test(rawLeagueId)
      ? rawLeagueId
      : /^\d+$/.test(rawLeagueId)
        ? `nfl.l.${rawLeagueId}`
        : rawLeagueId; // fallback for already-full keys
    
    console.log(`Fetching teams for league (raw: ${rawLeagueId}) -> using key: ${yahooLeagueKey}`);
    const teamsResponse = await fetch(
      `https://fantasysports.yahooapis.com/fantasy/v2/league/${yahooLeagueKey}/teams?format=json`,
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!teamsResponse.ok) {
      const errorText = await teamsResponse.text();
      console.error('Yahoo API error:', {
        status: teamsResponse.status,
        statusText: teamsResponse.statusText,
        body: errorText,
        leagueId: league.league_id
      });
      
      // Check if token expired
      if (teamsResponse.status === 401) {
        throw new Error('OAuth token expired. Please reconnect your Yahoo league.');
      }
      
      throw new Error(`Failed to fetch teams from Yahoo: ${teamsResponse.statusText} - ${errorText}`);
    }

    const teamsData = await teamsResponse.json();
    const teams = teamsData.fantasy_content?.league?.[1]?.teams || {};
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
      
      const rosterResponse = await fetch(
        `https://fantasysports.yahooapis.com/fantasy/v2/team/${teamKeyFull}/roster/players${weekParam}?format=json`,
        {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            'Content-Type': 'application/json',
          },
        }
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

      // Convert Yahoo roster to standard format
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

        // Debug: Log the raw player wrapper structure
        console.log(`\n=== Player: ${core.name?.full || core.name} ===`);
        console.log('Raw playerWrapper:', JSON.stringify(playerWrapper, null, 2));
        
        let selectedPosition = getSelectedPositionFromPlayerWrapper(playerWrapper);
        console.log(`Extracted selected_position: ${selectedPosition}`);
        
        if (!selectedPosition) {
          selectedPosition = core.display_position
            ?? (Array.isArray(core.eligible_positions) ? core.eligible_positions[0] : null)
            ?? 'BN';
          console.log(`Fallback selected_position: ${selectedPosition}`);
        }
        
        roster.push({
          player_id: core.player_id || '',
          player_name: core.name?.full || core.name || '',
          position: core.primary_position || core.display_position || '',
          team: core.editorial_team_abbr || '',
          selected_position: selectedPosition,
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

  } catch (error) {
    console.error('Resync error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
