import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";

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
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check for authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header provided' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      console.error('Auth error:', userError);
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { leagueId } = await req.json();

    // Get the league details from our database
    const { data: league, error: leagueError } = await supabase
      .from('connected_leagues')
      .select('league_id, id')
      .eq('id', leagueId)
      .eq('user_id', user.id)
      .single();

    if (leagueError || !league) {
      return new Response(
        JSON.stringify({ error: 'League not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const sleeperLeagueId = league.league_id;

    // Fetch league details from Sleeper API
    const leagueResponse = await fetch(`https://api.sleeper.app/v1/league/${sleeperLeagueId}`);
    if (!leagueResponse.ok) {
      throw new Error('Failed to fetch league from Sleeper');
    }
    const leagueData = await leagueResponse.json();

    // Get rosters for this league
    const rostersResponse = await fetch(`https://api.sleeper.app/v1/league/${sleeperLeagueId}/rosters`);
    if (!rostersResponse.ok) {
      throw new Error('Failed to fetch rosters from Sleeper');
    }
    const rosters = await rostersResponse.json();

    // Get users in the league
    const usersResponse = await fetch(`https://api.sleeper.app/v1/league/${sleeperLeagueId}/users`);
    const leagueUsers = usersResponse.ok ? await usersResponse.json() : [];

    // Get current NFL week
    let currentWeek = 1;
    try {
      const stateResp = await fetch('https://api.sleeper.app/v1/state/nfl');
      if (stateResp.ok) {
        const state = await stateResp.json();
        currentWeek = state?.week || currentWeek;
      }
    } catch (_) {}

    // Fetch Sleeper players data
    const playersResp = await fetch('https://api.sleeper.app/v1/players/nfl');
    const sleeperPlayers: Record<string, any> = playersResp.ok ? await playersResp.json() : {};

    // Build normalized players map
    const allPlayerIds: string[] = Array.from(new Set(
      rosters.flatMap((r: any) => (r.players || []).map((id: any) => id?.toString()).filter(Boolean))
    ));

    const normalizedMap = new Map<string, { player_name: string; position: string; team: string; canonical_player_id: string | null }>();
    
    // Get canonical player IDs for mapping
    const canonicalIdMap = new Map<string, string>();
    if (allPlayerIds.length > 0) {
      const { data: canonicalPlayers } = await supabase
        .from('canonical_players')
        .select('sleeper_id, id')
        .in('sleeper_id', allPlayerIds);
      
      if (canonicalPlayers && canonicalPlayers.length > 0) {
        for (const cp of canonicalPlayers) {
          canonicalIdMap.set(cp.sleeper_id, cp.id);
        }
      }
    }
    
    // Get player details from normalized_players table
    if (allPlayerIds.length > 0) {
      const { data: normPlayers } = await supabase
        .from('normalized_players')
        .select('sleeper_id, player_name, position, team')
        .in('sleeper_id', allPlayerIds);
      
      if (normPlayers && normPlayers.length > 0) {
        for (const p of normPlayers) {
          normalizedMap.set(p.sleeper_id, {
            player_name: p.player_name,
            position: p.position,
            team: p.team,
            canonical_player_id: canonicalIdMap.get(p.sleeper_id) || null,
          });
        }
      }
    }

    // For any missing players, get from Sleeper API
    const missingPlayerIds = allPlayerIds.filter((id: string) => !normalizedMap.has(id));
    if (missingPlayerIds.length > 0 && sleeperPlayers) {
      for (const playerId of missingPlayerIds) {
        const player = sleeperPlayers[playerId];
        if (player) {
          const playerName = `${player.first_name || ''} ${player.last_name || ''}`.trim() || player.full_name || 'Unknown Player';
          const position = player.position || 'FLEX';
          const team = player.team || 'FA';
          
          normalizedMap.set(playerId, {
            player_name: playerName,
            position: position,
            team: team,
            canonical_player_id: canonicalIdMap.get(playerId) || null,
          });
        }
      }
    }

    // Get all canonical player IDs from roster
    const canonicalIds = Array.from(new Set(
      Array.from(normalizedMap.values())
        .map(p => p.canonical_player_id)
        .filter(Boolean)
    ));

    // Fetch projections from player_pool_v2
    const projectionMap = new Map<string, number>();
    if (canonicalIds.length > 0) {
      const { data: projections } = await supabase
        .from('player_pool_v2')
        .select('canonical_player_id, projected_fp')
        .in('canonical_player_id', canonicalIds)
        .eq('week', currentWeek)
        .eq('season', new Date().getFullYear())
        .not('projected_fp', 'is', null);

      if (projections && projections.length > 0) {
        for (const proj of projections) {
          // Map canonical_player_id back to sleeper_id
          for (const [sleeperId, meta] of normalizedMap.entries()) {
            if (meta.canonical_player_id === proj.canonical_player_id) {
              projectionMap.set(sleeperId, Number(proj.projected_fp) || 0);
            }
          }
        }
      }
    }

    // Update all teams' rosters with canonical_player_id
    let teamsSynced = 0;
    for (const r of rosters) {
      const owner = leagueUsers.find((u: any) => u.user_id === r.owner_id);
      const teamName = owner?.metadata?.team_name || owner?.display_name || `Team ${r.roster_id}`;

      const startersSet = new Set((r.starters || []).map((id: any) => id?.toString()));
      const rosterArray = (r.players || []).map((pid: any) => {
        const id = pid?.toString();
        const meta = normalizedMap.get(id);
        return {
          player_id: id,
          canonical_player_id: meta?.canonical_player_id || null,
          player_name: meta?.player_name || 'Unknown Player',
          position: meta?.position || 'FLEX',
          team: meta?.team || 'NFL',
          projected: projectionMap.get(id) || 0,
          starter: startersSet.has(id),
        };
      });

      const totalProjected = rosterArray
        .filter((p: any) => p.starter)
        .reduce((sum: number, p: any) => sum + (p.projected || 0), 0);

      const wins = r.settings?.wins || 0;
      const losses = r.settings?.losses || 0;
      const ties = r.settings?.ties || 0;

      await supabase
        .from('user_teams')
        .upsert({
          league_id: league.id,
          team_id: r.roster_id?.toString(),
          team_name: teamName,
          roster: rosterArray,
          wins: wins,
          losses: losses,
          ties: ties,
          total_projected: totalProjected,
        }, {
          onConflict: 'league_id,team_id',
        });
      
      teamsSynced++;
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        teamsSynced,
        message: `Successfully resynced ${teamsSynced} teams`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error resyncing Sleeper league:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
