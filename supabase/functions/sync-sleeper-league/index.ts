import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";
import { getCorsHeaders } from "../_shared/cors.ts";


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
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
        JSON.stringify({ error: 'Unable to process request' }),
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
        JSON.stringify({ error: 'Unable to process request. Please try again.' }),
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
      
      // Fallback to Sleeper NFL state week if league settings are unavailable
      let providerWeek = Number.isFinite(matchupWeek) && matchupWeek > 0 ? matchupWeek : 1;
      try {
        const stateResp = await fetch('https://api.sleeper.app/v1/state/nfl');
        if (stateResp.ok) {
          const state = await stateResp.json();
          if (!providerWeek || providerWeek < 1) providerWeek = state?.week || 1;
        }
      } catch (_) {}
      
      // Fetch matchups for detected week (used to find opponent)
      const matchupsUrl = `https://api.sleeper.app/v1/league/${league.league_id}/matchups/${providerWeek}`;
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
          current_week: providerWeek,
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

      const normalizedMap = new Map<string, { player_name: string; position: string; team: string; canonical_player_id: string | null }>();
      
      // First, get canonical player IDs for mapping
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
      
      // Then get player details from normalized_players table
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
              canonical_player_id: canonicalIdMap.get(playerId) || null,
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

      // Fetch actual stats for the current week
      const statsMap = new Map<string, any>();
      try {
        const statsUrl = `https://api.sleeper.app/v1/stats/nfl/${currentYear}/${currentWeek}`;
        console.log('Fetching actual stats:', statsUrl);
        const statsResp = await fetch(statsUrl);
        if (statsResp.ok) {
          const stats = await statsResp.json();
          if (stats && typeof stats === 'object') {
            for (const [playerId, playerStats] of Object.entries(stats as Record<string, any>)) {
              statsMap.set(playerId, playerStats);
            }
            console.log(`Loaded ${statsMap.size} player stats`);
          }
        }
      } catch (err) {
        console.error('Error fetching stats:', err);
      }

      // Fetch projections from projected_player_stats table by matching player names
      const projectionMap = new Map<string, number>();
      try {
        console.log(`Fetching projections from database for week ${currentWeek}, season ${currentYear}`);
        
        // Get all projections for the current week
        const { data: dbProjections, error: projError } = await supabase
          .from('projected_player_stats')
          .select('player_id, player_name, projected_fp')
          .eq('week', currentWeek)
          .eq('season', currentYear)
          .gt('projected_fp', 0);

        if (projError) {
          console.error('Error fetching projections from database:', projError);
        } else if (dbProjections && dbProjections.length > 0) {
          // Create a map of normalized player names to projections
          const nameToProjectionMap = new Map<string, number>();
          for (const proj of dbProjections) {
            const normalizedName = proj.player_name.toLowerCase().replace(/[^a-z]/g, '');
            nameToProjectionMap.set(normalizedName, Number(proj.projected_fp));
          }
          
          // Match Sleeper players by name to projections
          for (const [sleeperId, meta] of normalizedMap.entries()) {
            const normalizedName = meta.player_name.toLowerCase().replace(/[^a-z]/g, '');
            const projection = nameToProjectionMap.get(normalizedName);
            if (projection && projection > 0) {
              projectionMap.set(sleeperId, projection);
            }
          }
          
          console.log(`Loaded ${projectionMap.size} projections from database (matched by player name)`);
        }

        // Fallback to Sleeper API if no database projections found or all are zero
        if (projectionMap.size === 0) {
          console.log('No database projections found, falling back to Sleeper API');
          const baseProjUrl = `https://api.sleeper.app/v1/projections/nfl/${currentYear}/${currentWeek}`;
          console.log('Fetching from:', baseProjUrl);
          const projResp = await fetch(baseProjUrl);
          if (projResp.ok) {
            const projections: any = await projResp.json();
            console.log('Sleeper API response type:', Array.isArray(projections) ? 'array' : typeof projections);
            
            if (Array.isArray(projections)) {
              for (const p of projections) {
                const id = (p.player_id || '').toString();
                const stats = (p.stats || p);
                const pts = stats[projField] ?? stats.pts_ppr ?? stats.pts_half_ppr ?? stats.pts_std ?? 0;
                if (id && pts > 0) {
                  projectionMap.set(id, Number(pts));
                }
              }
              console.log(`Loaded ${projectionMap.size} projections from Sleeper API (array)`);
            } else if (projections && typeof projections === 'object') {
              for (const [playerId, stats] of Object.entries(projections as Record<string, any>)) {
                const s = stats as any;
                const pts = s[projField] ?? s.pts_ppr ?? s.pts_half_ppr ?? s.pts_std ?? 0;
                if (pts > 0) {
                  projectionMap.set(playerId, Number(pts));
                }
              }
              console.log(`Loaded ${projectionMap.size} projections from Sleeper API (object)`);
            }
          } else {
            console.error('Sleeper API returned status:', projResp.status);
          }
        }
      } catch (err) {
        console.error('Error fetching projections:', err);
      }

      // Collect player stats for player_stats table
      const playerStatsToInsert: any[] = [];
      for (const [playerId, stats] of statsMap.entries()) {
        const meta = normalizedMap.get(playerId);
        if (meta) {
          playerStatsToInsert.push({
            player_id: playerId,
            player_name: meta.player_name,
            team: meta.team,
            position: meta.position,
            week: currentWeek,
            season: currentYear,
            passing_yards: stats.pass_yd || 0,
            passing_tds: stats.pass_td || 0,
            interceptions: stats.pass_int || 0,
            passing_completions: stats.pass_cmp || 0,
            passing_attempts: stats.pass_att || 0,
            rushing_yards: stats.rush_yd || 0,
            rushing_tds: stats.rush_td || 0,
            rushing_attempts: stats.rush_att || 0,
            receiving_yards: stats.rec_yd || 0,
            receiving_tds: stats.rec_td || 0,
            receptions: stats.rec || 0,
            receiving_targets: stats.rec_tgt || 0,
            fumbles_lost: stats.fum_lost || 0,
            passing_2pt_conversions: stats.pass_2pt || 0,
            rushing_2pt_conversions: stats.rush_2pt || 0,
            receiving_2pt_conversions: stats.rec_2pt || 0,
            source: 'sleeper',
            source_type: 'actual',
            confidence: 0.92,
            freshness_ts: new Date().toISOString(),
            finalized: false,
            raw_data: stats,
          });
        }
      }

      // Batch insert player stats
      if (playerStatsToInsert.length > 0) {
        console.log(`Inserting ${playerStatsToInsert.length} player stats for week ${currentWeek}`);
        await supabase
          .from('player_stats')
          .upsert(playerStatsToInsert, { 
            onConflict: 'player_id,week,season,source',
            ignoreDuplicates: false 
          });
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
            canonical_player_id: meta?.canonical_player_id || null,
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

      // Populate waiver_wire_players from projected_player_stats
      try {
        console.log('Populating waiver wire from projected_player_stats...');
        
        // Get all rostered player IDs
        const rosteredPlayerIds = new Set(
          rosters.flatMap((r: any) => (r.players || []).map((id: any) => id?.toString()))
        );

        // Query projected_player_stats for non-rostered players
        const { data: waiverProjections } = await supabase
          .from('projected_player_stats')
          .select('player_id, player_name, position, team, projected_fp, provider_ids, stats, applied_breakdown, confidence, status_flags')
          .eq('week', currentWeek)
          .eq('season', currentYear)
          .order('projected_fp', { ascending: false })
          .limit(500); // Top 500 available players

        if (waiverProjections && waiverProjections.length > 0) {
          const waiverRows = [];
          
          for (const proj of waiverProjections) {
            // Check if player is available (not rostered)
            const providerIds = proj.provider_ids as any;
            const sleeperId = providerIds?.sleeper_id || proj.player_id;
            
            // Skip if player is rostered
            if (rosteredPlayerIds.has(sleeperId)) {
              continue;
            }

            waiverRows.push({
              league_id: connectedLeague.id,
              espn_league_id: league.league_id, // Using league_id as identifier
              season: currentYear,
              week: currentWeek,
              player_id: proj.player_id,
              player_name: proj.player_name,
              position: proj.position,
              team: proj.team,
              projected_fp: proj.projected_fp || 0,
              waiver_status: 'FREEAGENT',
              stats: proj.stats || {},
              applied_breakdown: proj.applied_breakdown || {},
              confidence: proj.confidence || 0.8,
              status_flags: proj.status_flags || {},
              source: 'sleeper_db_projection',
              provider_ids: proj.provider_ids || {},
            });
          }

          if (waiverRows.length > 0) {
            const { error: waiverError } = await supabase
              .from('waiver_wire_players')
              .upsert(waiverRows, {
                onConflict: 'league_id,season,week,player_id',
                ignoreDuplicates: false
              });
            
            if (waiverError) {
              console.error('Error upserting waiver wire players:', waiverError);
            } else {
              console.log(`Populated ${waiverRows.length} waiver wire players for league ${league.league_id}`);
            }
          }
        }
      } catch (err) {
        console.error('Error populating waiver wire:', err);
      }

      // Compute player values and positional strengths for rankings
      try {
        console.log(`Computing player values and positional strengths for league ${connectedLeague.id}`);
        const { error: computeError } = await supabase.functions.invoke('post-sync-compute', {
          body: { leagueId: connectedLeague.id },
          headers: { Authorization: authHeader }
        });
        
        if (computeError) {
          console.error('Error computing player values and strengths:', computeError);
        } else {
          console.log(`Successfully computed player values and strengths for league ${connectedLeague.id}`);
        }
      } catch (err) {
        console.error('Error invoking post-sync-compute:', err);
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