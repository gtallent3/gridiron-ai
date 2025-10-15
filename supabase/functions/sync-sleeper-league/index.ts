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

      // Get rosters for this league
      const rostersResponse = await fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`);
      if (!rostersResponse.ok) {
        continue;
      }
      const rosters = await rostersResponse.json();

      // Get users in the league to match roster to team names
      const usersResponse = await fetch(`https://api.sleeper.app/v1/league/${league.league_id}/users`);
      const leagueUsers = usersResponse.ok ? await usersResponse.json() : [];

      // Find user's roster to get team_id
      const userRoster = rosters.find((r: any) => {
        const leagueUser = leagueUsers.find((u: any) => u.user_id === sleeperUser.user_id);
        return leagueUser && r.owner_id === leagueUser.user_id;
      });

      const userTeamId = userRoster?.roster_id?.toString();

      // Get matchup week from league settings
      const matchupWeek = parseInt(league.settings?.leg || '1');
      
      // Fetch matchups for current week
      const matchupsUrl = `https://api.sleeper.app/v1/league/${league.league_id}/matchups/${matchupWeek}`;
      const matchupsResponse = await fetch(matchupsUrl);
      
      let matchupData: any = {};
      if (matchupsResponse.ok) {
        const matchups = await matchupsResponse.json();
        const userMatchup = matchups.find((m: any) => m.roster_id === userRoster?.roster_id);
        
        if (userMatchup && userMatchup.matchup_id) {
          // Find opponent in same matchup
          const opponentMatchup = matchups.find((m: any) => 
            m.matchup_id === userMatchup.matchup_id && m.roster_id !== userRoster?.roster_id
          );
          
          if (opponentMatchup) {
            matchupData = {
              current_week: matchupWeek,
              opponent_team_id: opponentMatchup.roster_id.toString(),
            };
          }
        }
      }

      // Upsert league with user's team_id and matchup info
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
          user_team_id: userTeamId,
          last_synced_at: new Date().toISOString(),
          ...matchupData,
        }, {
          onConflict: 'user_id,platform,league_id',
        })
        .select()
        .single();

      if (leagueError) {
        continue;
      }

      // Fetch Sleeper players data (cached on Sleeper's side, updated daily)
      const playersResp = await fetch('https://api.sleeper.app/v1/players/nfl');
      const sleeperPlayers: Record<string, any> = playersResp.ok ? await playersResp.json() : {};

      // Build normalized players map for this league's rosters
      const allPlayerIds: string[] = Array.from(new Set(
        rosters.flatMap((r: any) => (r.players || []).map((id: any) => id?.toString()).filter(Boolean))
      ));

      const normalizedMap = new Map<string, { player_name: string; position: string; team: string }>();
      
      // First, try to get from normalized_players table
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
            });
          }
        }
      }

      // For any missing players, get from Sleeper API and store in normalized_players
      const missingPlayerIds = allPlayerIds.filter((id: string) => !normalizedMap.has(id));
      if (missingPlayerIds.length > 0 && sleeperPlayers) {
        const playersToInsert = [];
        
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
            });
            
            playersToInsert.push({
              player_id: playerId,
              sleeper_id: playerId,
              player_name: playerName,
              position: position,
              team: team,
            });
          }
        }
        
        // Batch insert new players
        if (playersToInsert.length > 0) {
          await supabase
            .from('normalized_players')
            .upsert(playersToInsert, { onConflict: 'sleeper_id', ignoreDuplicates: true });
        }
      }

      // Determine current NFL week and fetch projections for this league
      let currentWeek = 1;
      try {
        const stateResp = await fetch('https://api.sleeper.app/v1/state/nfl');
        if (stateResp.ok) {
          const state = await stateResp.json();
          currentWeek = state?.week || currentWeek;
          console.log('Current NFL week:', currentWeek);
        }
      } catch (err) { 
        console.error('Error fetching NFL state:', err);
      }

      // Choose projection scoring type based on league settings
      const projType = scoringType === 'ppr' ? 'ppr' : (scoringType === 'half_ppr' ? 'half_ppr' : 'std');
      const projField = projType === 'ppr' ? 'pts_ppr' : (projType === 'half_ppr' ? 'pts_half_ppr' : 'pts_std');

      // Fetch projections for the current week with robust fallbacks
      const projectionMap = new Map<string, number>();
      try {
        // Attempt 1: Default projections endpoint (array expected)
        const baseProjUrl = `https://api.sleeper.app/v1/projections/nfl/${currentYear}/${currentWeek}`;
        console.log('Fetching projections (base):', baseProjUrl);
        let projResp = await fetch(baseProjUrl);
        if (projResp.ok) {
          const projections: any = await projResp.json();
          if (Array.isArray(projections)) {
            for (const p of projections) {
              const id = (p.player_id || '').toString();
              const stats = (p.stats || p);
              const pts = stats[projField] ?? stats.pts_ppr ?? stats.pts_half_ppr ?? stats.pts_std ?? 0;
              if (id) projectionMap.set(id, Number(pts) || 0);
            }
            console.log(`Loaded (base) ${projectionMap.size} projections`);
          } else if (projections && typeof projections === 'object') {
            // Sometimes returns object keyed by player_id
            for (const [playerId, stats] of Object.entries(projections as Record<string, any>)) {
              const s = stats as any;
              const pts = s[projField] ?? s.pts_ppr ?? s.pts_half_ppr ?? s.pts_std ?? 0;
              projectionMap.set(playerId, Number(pts) || 0);
            }
            console.log(`Loaded (base-object) ${projectionMap.size} projections`);
          }
        }

        // Attempt 2: If empty, try projections with scoring type query
        if (projectionMap.size === 0) {
          const typedProjUrl = `https://api.sleeper.app/v1/projections/nfl/${currentYear}/${currentWeek}?type=${projType}`;
          console.log('Fetching projections (typed):', typedProjUrl);
          projResp = await fetch(typedProjUrl);
          if (projResp.ok) {
            const projections2: any = await projResp.json();
            if (Array.isArray(projections2)) {
              for (const p of projections2) {
                const id = (p.player_id || '').toString();
                const stats = (p.stats || p);
                const pts = stats[projField] ?? stats.pts_ppr ?? stats.pts_half_ppr ?? stats.pts_std ?? 0;
                if (id) projectionMap.set(id, Number(pts) || 0);
              }
            } else if (projections2 && typeof projections2 === 'object') {
              for (const [playerId, stats] of Object.entries(projections2 as Record<string, any>)) {
                const s = stats as any;
                const pts = s[projField] ?? s.pts_ppr ?? s.pts_half_ppr ?? s.pts_std ?? 0;
                projectionMap.set(playerId, Number(pts) || 0);
              }
            }
            console.log(`Loaded (typed) ${projectionMap.size} projections`);
          } else {
            console.error('Typed projections fetch failed:', projResp.status, projResp.statusText);
          }
        }
      } catch (err) {
        console.error('Error fetching projections:', err);
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
            projected: projectionMap.get(id) || 0,
            starter: startersSet.has(id),
          };
        });

        // Calculate total projected points for starters
        const totalProjected = rosterArray
          .filter((p: any) => p.starter)
          .reduce((sum: number, p: any) => sum + (p.projected || 0), 0);

        // Get team record from roster settings
        const wins = r.settings?.wins || 0;
        const losses = r.settings?.losses || 0;
        const ties = r.settings?.ties || 0;

        await supabase
          .from('user_teams')
          .upsert({
            league_id: connectedLeague.id,
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