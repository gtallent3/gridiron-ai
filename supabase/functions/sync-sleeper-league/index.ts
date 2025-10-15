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
      console.error('Authentication failed');
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

    console.log('Processing user lookup request');

    // Get user from Sleeper API (encode username for URL safety)
    const encodedUsername = encodeURIComponent(username);
    const userResponse = await fetch(`https://api.sleeper.app/v1/user/${encodedUsername}`);
    
    if (!userResponse.ok) {
      console.error('External API error:', userResponse.status);
      return new Response(
        JSON.stringify({ error: 'Unable to find user' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const sleeperUser = await userResponse.json();

    // Get user's leagues for current season (NFL season typically starts in September)
    const now = new Date();
    const currentYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    console.log(`Fetching leagues for season: ${currentYear}`);
    
    const leaguesResponse = await fetch(`https://api.sleeper.app/v1/user/${sleeperUser.user_id}/leagues/nfl/${currentYear}`);
    
    if (!leaguesResponse.ok) {
      console.error('External API error fetching leagues:', leaguesResponse.status);
      return new Response(
        JSON.stringify({ error: 'Unable to fetch leagues' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const leagues = await leaguesResponse.json();

    console.log(`Found ${leagues.length} leagues for user`);

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
        console.error('Database error during league sync');
        continue;
      }

      // Get rosters for this league
      const rostersResponse = await fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`);
      if (!rostersResponse.ok) {
        console.error('External API error fetching rosters');
        continue;
      }
      const rosters = await rostersResponse.json();

      // Get users in the league to match roster to team names
      const usersResponse = await fetch(`https://api.sleeper.app/v1/league/${league.league_id}/users`);
      const leagueUsers = usersResponse.ok ? await usersResponse.json() : [];

      // Find user's roster
      const userRoster = rosters.find((r: any) => {
        const leagueUser = leagueUsers.find((u: any) => u.user_id === sleeperUser.user_id);
        return leagueUser && r.owner_id === leagueUser.user_id;
      });

      if (userRoster) {
        const leagueUser = leagueUsers.find((u: any) => u.user_id === sleeperUser.user_id);
        const teamName = leagueUser?.metadata?.team_name || leagueUser?.display_name || 'My Team';

        // Upsert team
        await supabase
          .from('user_teams')
          .upsert({
            league_id: connectedLeague.id,
            team_id: userRoster.roster_id.toString(),
            team_name: teamName,
            roster: {
              starters: userRoster.starters || [],
              players: userRoster.players || [],
              reserve: userRoster.reserve || [],
            },
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