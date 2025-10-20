import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Comprehensive credential sanitization for logs
const sanitizeError = (err: any): string => {
  let fullError = '';
  
  // Combine message and stack trace
  if (err?.message) fullError += err.message;
  if (err?.stack) fullError += '\n' + err.stack;
  if (!fullError) fullError = String(err);
  
  return fullError
    // Redact ESPN credentials
    .replace(/espn_s2[=:][^;\\s&]+/gi, 'espn_s2=***')
    .replace(/SWID[=:][^;\\s&}]+/gi, 'SWID=***')
    // Redact Cookie headers entirely
    .replace(/Cookie:\s*[^\n]+/gi, 'Cookie: [REDACTED]')
    .replace(/['"]Cookie['"]\s*:\s*[^\n,}]+/gi, '"Cookie": "[REDACTED]"')
    // Redact long base64-like strings that could be tokens
    .replace(/[A-Z0-9+/%]{100,}/g, '[REDACTED]')
    // Redact URL-encoded credentials
    .replace(/espn_s2%[0-9A-F]{2}[^\\s&]*/gi, 'espn_s2=***')
    .replace(/SWID%[0-9A-F]{2}[^\\s&}]*/gi, 'SWID=***');
};

const getTeamAbbreviation = (teamId: number): string => {
  const teams: Record<number, string> = {
    1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET',
    9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN',
    17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC',
    25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU'
  };
  return teams[teamId] || 'FA';
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    
    if (!authHeader) {
      console.error('Missing authorization header');
      throw new Error('Authentication required');
    }

    const token = authHeader.replace('Bearer ', '');
    
    // Create user-authenticated client for RPC calls
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    
    // Create service role client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Verify user with their token
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser(token);

    if (authError || !user) {
      console.error('Auth error:', authError);
      throw new Error('Authentication required');
    }

    const { leagueId } = await req.json();
    
    // Log request without sensitive data
    console.log('Resync request for league ID:', leagueId?.substring(0, 6) + '***');

    if (!leagueId) {
      throw new Error('League ID is required');
    }

    // Get league info from database
    const { data: leagueData, error: leagueError } = await supabase
      .from('connected_leagues')
      .select('league_id, platform')
      .eq('id', leagueId)
      .eq('user_id', user.id)
      .single();

    if (leagueError || !leagueData) {
      throw new Error('League not found');
    }

    if (leagueData.platform !== 'espn') {
      throw new Error('This function only supports ESPN leagues');
    }

    // Retrieve stored credentials - use user-authenticated client for RPC call
    const { data: credentials, error: credError } = await supabaseUser.rpc('get_league_credentials', {
      p_user_id: user.id,
      p_platform: 'espn',
      p_league_id: leagueData.league_id
    });

    if (credError || !credentials) {
      console.error('Failed to retrieve credentials');
      throw new Error('Unable to retrieve stored credentials. Please reconnect your league.');
    }

    console.log('Credentials retrieved successfully');

    const { espn_s2, swid } = credentials;

    if (!espn_s2 || !swid) {
      throw new Error('Invalid stored credentials. Please reconnect your league.');
    }

    // Get current NFL season
    const now = new Date();
    const currentYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;

    // Fetch league data from ESPN API
    const leagueUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${currentYear}/segments/0/leagues/${leagueData.league_id}?view=mSettings&view=mTeam&view=mRoster&view=mMembers&view=kona_player_info`;
    
    const leagueResponse = await fetch(leagueUrl, {
      headers: {
        'Cookie': `espn_s2=${espn_s2}; SWID=${swid}`,
      },
    });

    if (!leagueResponse.ok) {
      if (leagueResponse.status === 401) {
        throw new Error('Stored credentials expired. Please reconnect your league.');
      }
      throw new Error('Unable to fetch league data from ESPN');
    }

    const espnLeagueData = await leagueResponse.json();

    // Determine scoring type
    let scoringType = 'standard';
    if (espnLeagueData.settings?.scoringSettings?.scoringItems) {
      const scoringItems = espnLeagueData.settings.scoringSettings.scoringItems;
      const pprScore = scoringItems['53']?.points || scoringItems[53]?.points || scoringItems['53'] || scoringItems[53];
      
      if (pprScore !== undefined && pprScore !== null) {
        if (pprScore === 1 || pprScore === 1.0) {
          scoringType = 'ppr';
        } else if (pprScore === 0.5) {
          scoringType = 'half_ppr';
        } else if (pprScore > 0) {
          scoringType = 'custom';
        }
      }
    }

    // Find user's team
    const normalizeId = (id: string): string => {
      return (id || '').trim().toLowerCase().replace(/[{}\-]/g, '');
    };

    const normalizedSwid = normalizeId(swid);
    const userTeam = espnLeagueData.teams?.find((team: any) => {
      const owners = (team.owners || []).map(normalizeId);
      const primaryOwner = normalizeId(team.primaryOwner || '');
      return owners.includes(normalizedSwid) || (primaryOwner && primaryOwner === normalizedSwid);
    });

    if (!userTeam) {
      throw new Error('Unable to find your team in this league');
    }

    // Get matchup data
    const currentWeek = espnLeagueData.scoringPeriodId || 1;
    const currentMatchupPeriod = espnLeagueData.currentMatchupPeriod || currentWeek;

    const scheduleUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${currentYear}/segments/0/leagues/${leagueData.league_id}?view=mMatchup&view=mMatchupScore`;
    const scheduleResponse = await fetch(scheduleUrl, {
      headers: {
        'Cookie': `espn_s2=${espn_s2}; SWID=${swid}`,
      },
    });

    let matchupData: any = {};
    if (scheduleResponse.ok) {
      const scheduleData = await scheduleResponse.json();
      const currentMatchup = scheduleData.schedule?.find((m: any) => 
        m.matchupPeriodId === currentMatchupPeriod && 
        (m.home?.teamId === userTeam.id || m.away?.teamId === userTeam.id)
      );
      
      if (currentMatchup) {
        const isHome = currentMatchup.home?.teamId === userTeam.id;
        const opponentTeamId = isHome ? currentMatchup.away?.teamId : currentMatchup.home?.teamId;
        matchupData = {
          current_week: currentMatchupPeriod,
          opponent_team_id: opponentTeamId?.toString(),
        };
      }
    }

    // Update league data
    const { data: updatedLeague, error: updateError } = await supabase
      .from('connected_leagues')
      .update({
        league_name: espnLeagueData.settings.name,
        league_size: espnLeagueData.settings.size,
        scoring_type: scoringType,
        scoring_settings: espnLeagueData.settings.scoringSettings,
        user_team_id: userTeam.id.toString(),
        last_synced_at: new Date().toISOString(),
        ...matchupData,
      })
      .eq('id', leagueId)
      .select()
      .single();

    if (updateError) {
      throw new Error('Unable to update league data');
    }

    // Collect all ESPN player IDs
    const allEspnPlayerIds = new Set<string>();
    for (const team of espnLeagueData.teams || []) {
      for (const entry of team.roster?.entries || []) {
        if (entry.playerId) {
          allEspnPlayerIds.add(entry.playerId.toString());
        }
      }
    }

    // Build normalized player map
    const normalizedMap = new Map<string, { player_id: string; player_name: string; position: string; team: string }>();
    
    if (allEspnPlayerIds.size > 0) {
      const { data: normPlayers } = await supabase
        .from('normalized_players')
        .select('espn_id, player_id, player_name, position, team')
        .in('espn_id', Array.from(allEspnPlayerIds));
      
      if (normPlayers && normPlayers.length > 0) {
        for (const p of normPlayers) {
          if (p.espn_id) {
            normalizedMap.set(p.espn_id, {
              player_id: p.player_id,
              player_name: p.player_name,
              position: p.position,
              team: p.team,
            });
          }
        }
      }
    }

    // Create missing player entries
    const playersToInsert = [];
    for (const team of espnLeagueData.teams || []) {
      for (const entry of team.roster?.entries || []) {
        const espnId = entry.playerId?.toString();
        if (espnId && !normalizedMap.has(espnId)) {
          const player = entry.playerPoolEntry?.player;
          const playerName = player?.fullName || 'Unknown Player';
          const position = player?.defaultPositionId?.toString() || 'FLEX';
          const teamAbbr = player?.proTeamId ? getTeamAbbreviation(player.proTeamId) : 'FA';
          
          const normalizedPlayerId = `espn_${espnId}`;
          
          normalizedMap.set(espnId, {
            player_id: normalizedPlayerId,
            player_name: playerName,
            position: position,
            team: teamAbbr,
          });
          
          playersToInsert.push({
            player_id: normalizedPlayerId,
            espn_id: espnId,
            player_name: playerName,
            position: position,
            team: teamAbbr,
          });
        }
      }
    }

    if (playersToInsert.length > 0) {
      await supabase
        .from('normalized_players')
        .upsert(playersToInsert, { onConflict: 'espn_id', ignoreDuplicates: true });
    }

    // Sync all teams
    for (const team of espnLeagueData.teams || []) {
      const roster = (team.roster?.entries || []).map((entry: any) => {
        const player = entry.playerPoolEntry?.player;
        const espnId = entry.playerId?.toString();
        const normalizedPlayer = espnId ? normalizedMap.get(espnId) : null;
        
        // Get current week projection and calculate ROS from ESPN's weekly projections
        let projected = 0;
        let rosProjection = 0;
        let ppgProjection = 0;
        
        if (player?.stats) {
          // Current week projection
          const currentWeekStat = player.stats.find((stat: any) => 
            stat.statSourceId === 1 && stat.scoringPeriodId === espnLeagueData.scoringPeriodId
          );
          projected = currentWeekStat?.appliedTotal || 0;
          
          // Remaining-week projections available from ESPN (often just current week)
          const weeksRemaining = Math.max(18 - currentWeek, 1);
          const remainingWeekProjections = player.stats
            .filter((stat: any) => 
              stat.statSourceId === 1 && 
              stat.scoringPeriodId >= currentWeek && 
              stat.scoringPeriodId <= 18
            )
            .map((stat: any) => stat.appliedTotal || 0);
          
          const availableWeeks = remainingWeekProjections.length;
          if (availableWeeks > 1) {
            rosProjection = remainingWeekProjections.reduce((sum: number, pts: number) => sum + pts, 0);
            ppgProjection = rosProjection / availableWeeks;
          } else if (availableWeeks === 1) {
            const w = remainingWeekProjections[0] || projected || 0;
            ppgProjection = w;
            rosProjection = w * weeksRemaining;
          } else if (projected > 0) {
            ppgProjection = projected;
            rosProjection = projected * weeksRemaining;
          }
        }

        return {
          player_id: normalizedPlayer?.player_id || espnId || 'unknown',
          espn_id: espnId,
          player_name: normalizedPlayer?.player_name || player?.fullName,
          position: normalizedPlayer?.position || player?.defaultPositionId,
          team: normalizedPlayer?.team || (player?.proTeamId ? getTeamAbbreviation(player.proTeamId) : null),
          projected,
          ros_projection: rosProjection,
          ppg_projection: ppgProjection,
          slot: entry.lineupSlotId,
        };
      });

      const STARTER_SLOTS = [0, 2, 4, 6, 16, 17, 23];
      const totalProjected = roster
        .filter((p: any) => STARTER_SLOTS.includes(p.slot))
        .reduce((sum: number, p: any) => sum + (p.projected || 0), 0);

      const record = team.record?.overall || { wins: 0, losses: 0, ties: 0 };

      await supabase
        .from('user_teams')
        .upsert({
          league_id: updatedLeague.id,
          team_id: team.id.toString(),
          team_name: team.name || `${team.location} ${team.nickname}`,
          roster: roster,
          wins: record.wins || 0,
          losses: record.losses || 0,
          ties: record.ties || 0,
          total_projected: totalProjected,
        }, {
          onConflict: 'league_id,team_id',
        });
    }

    return new Response(
      JSON.stringify({
        message: `Successfully resynced ${espnLeagueData.settings.name}`,
        league: {
          name: espnLeagueData.settings.name,
          id: leagueData.league_id,
          platform: 'espn',
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    // Comprehensive error sanitization
    console.error('Resync error:', sanitizeError(error));
    
    let userMessage = 'Unable to resync your league. Please try again.';
    
    if (error.message?.includes('credentials')) {
      userMessage = error.message;
    } else if (error.message?.includes('authenticate') || error.message?.includes('expired')) {
      userMessage = 'Your stored credentials have expired. Please reconnect your league.';
    } else if (error.message?.includes('team')) {
      userMessage = 'Unable to find your team in this league.';
    }
    
    return new Response(
      JSON.stringify({ error: userMessage }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
