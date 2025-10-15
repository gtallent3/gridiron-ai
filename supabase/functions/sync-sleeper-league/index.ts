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
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { username: rawUsername } = await req.json();

    // Validate username format and length
    if (!rawUsername || typeof rawUsername !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Invalid request' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const username = rawUsername.trim();
    
    if (username.length < 3 || username.length > 25) {
      return new Response(
        JSON.stringify({ error: 'Invalid username length' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return new Response(
        JSON.stringify({ error: 'Invalid username format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user from Sleeper API (encode username for URL safety)
    const encodedUsername = encodeURIComponent(username);
    const userResponse = await fetch(`https://api.sleeper.app/v1/user/${encodedUsername}`);
    
    if (!userResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Unable to find user' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const sleeperUser = await userResponse.json();

    // Get user's leagues for current season (NFL season typically starts in September)
    const now = new Date();
    const currentYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    
    const leaguesResponse = await fetch(`https://api.sleeper.app/v1/user/${sleeperUser.user_id}/leagues/nfl/${currentYear}`);
    
    if (!leaguesResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Unable to fetch leagues' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const leagues = await leaguesResponse.json();

    // Sync each league
    const syncedLeagues = [];
    for (const league of leagues) {
      // Determine scoring type
      let scoringType = 'standard';
      if (league.scoring_settings?.rec === 1) {
        scoringType = 'ppr';
      } else if (league.scoring_settings?.rec === 0.5) {
        scoringType = 'half_ppr';
      } else if (league.scoring_settings && Object.keys(league.scoring_settings).length > 10) {
        scoringType = 'custom';
      }

      // Upsert league
      const { data: connectedLeague, error: leagueError } = await supabase
        .from('connected_leagues')
        .upsert({
          user_id: user.id,
          platform: 'sleeper',
          league_id: league.league_id,
          league_name: league.name,
          scoring_type: scoringType,
          league_size: league.total_rosters,
          scoring_settings: league.scoring_settings,
          last_synced_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id,platform,league_id',
        })
        .select()
        .single();

      if (leagueError) {
        continue;
      }

      // Get rosters for this league
      const rostersResponse = await fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`);
      if (!rostersResponse.ok) {
        continue;
      }
      const rosters = await rostersResponse.json();

      // Get users in the league to match roster to team names
      const usersResponse = await fetch(`https://api.sleeper.app/v1/league/${league.league_id}/users`);
      const leagueUsers = usersResponse.ok ? await usersResponse.json() : [];

      // Build normalized players map for this league's rosters
      const allPlayerIds = Array.from(new Set(
        rosters.flatMap((r: any) => (r.players || []).map((id: any) => id?.toString()))
      ));

      let normalizedMap = new Map<string, { player_name: string; position: string; team: string }>();
      if (allPlayerIds.length > 0) {
        const { data: normPlayers } = await supabase
          .from('normalized_players')
          .select('sleeper_id, player_name, position, team')
          .in('sleeper_id', allPlayerIds);
        if (normPlayers) {
          for (const p of normPlayers) {
            normalizedMap.set(p.sleeper_id, {
              player_name: p.player_name,
              position: p.position,
              team: p.team,
            });
          }
        }
      }

      // Upsert ALL teams in the league so "Other Teams" can be displayed
      for (const r of rosters) {
        const owner = leagueUsers.find((u: any) => u.user_id === r.owner_id);
        const teamName = owner?.metadata?.team_name || owner?.display_name || `Team ${r.roster_id}`;

        const startersSet = new Set((r.starters || []).map((id: any) => id?.toString()));
        const rosterArray = (r.players || []).map((pid: any) => {
          const id = pid?.toString();
          const meta = normalizedMap.get(id);
          return {
            player_id: id,
            player_name: meta?.player_name || 'Unknown Player',
            position: meta?.position || 'FLEX',
            team: meta?.team || 'NFL',
            projected: 0,
            starter: startersSet.has(id),
          };
        });

        await supabase
          .from('user_teams')
          .upsert({
            league_id: connectedLeague.id,
            team_id: r.roster_id?.toString(),
            team_name: teamName,
            roster: rosterArray,
          }, {
            onConflict: 'league_id,team_id',
          });
      }

      syncedLeagues.push({
        league_id: league.league_id,
        league_name: league.name,
        scoring_type: scoringType,
      });
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        leagues: syncedLeagues,
        message: `Successfully synced ${syncedLeagues.length} league(s)`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('League sync error:', error);
    return new Response(
      JSON.stringify({ error: 'Unable to sync leagues' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});