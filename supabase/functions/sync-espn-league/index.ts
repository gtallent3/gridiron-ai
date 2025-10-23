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

// ESPN Pro Team ID to abbreviation mapping
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
    
    // Create service role client for other operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser(token);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    const requestBody = await req.json();
    const { espn_s2, swid, leagueId } = requestBody;

    // Log request without credentials
    console.log('Sync request for league:', leagueId?.substring(0, 6) + '***');

    if (!espn_s2 || !swid || !leagueId) {
      throw new Error('Missing required credentials');
    }

    // Validate ESPN credentials format and length to prevent injection attacks
    if (typeof espn_s2 !== 'string' || espn_s2.length > 500 || espn_s2.length < 10) {
      throw new Error('Invalid credentials format');
    }
    
    if (typeof swid !== 'string' || swid.length > 100 || swid.length < 10) {
      throw new Error('Invalid credentials format');
    }
    
    // Validate credentials contain only safe characters (alphanumeric, hyphens, underscores, percent, braces)
    if (!/^[a-zA-Z0-9\-_%]+$/.test(espn_s2)) {
      throw new Error('Invalid credentials format');
    }
    
    if (!/^[a-zA-Z0-9\-{}]+$/.test(swid)) {
      throw new Error('Invalid credentials format');
    }

    // Validate league ID format
    if (typeof leagueId !== 'string' || !/^[0-9]+$/.test(leagueId) || leagueId.length > 20) {
      throw new Error('Invalid credentials format');
    }

    // Store credentials securely - isolate from error context
    let credentialStored = false;

    // Store credentials securely in Vault - handle errors without credential context
    try {
      const { error: storeError } = await supabaseUser.rpc('store_league_credentials', {
        p_user_id: user.id,
        p_platform: 'espn',
        p_league_id: leagueId,
        p_credentials: { espn_s2, swid }
      });

      if (storeError) {
        console.error('[ERR_CRED_001] Credential storage failed');
        throw new Error('Unable to save credentials');
      }
      
      credentialStored = true;
    } catch (error) {
      // Log error without any credential context
      console.error('[ERR_CRED_002] Credential operation failed');
      throw new Error('Unable to save credentials');
    }

    // Get current NFL season
    const now = new Date();
    const currentYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;

    // Fetch league data from ESPN API - isolate credentials from error handling
    const leagueUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${currentYear}/segments/0/leagues/${leagueId}?view=mSettings&view=mTeam&view=mRoster&view=mMembers&view=kona_player_info`;
    
    let leagueData;
    try {
      const leagueResponse = await fetch(leagueUrl, {
        headers: {
          'Cookie': `espn_s2=${espn_s2}; SWID=${swid}`,
        },
      });

      if (!leagueResponse.ok) {
        if (leagueResponse.status === 401) {
          throw new Error('Unable to authenticate with the provided credentials');
        }
        throw new Error('Unable to fetch league data');
      }

      leagueData = await leagueResponse.json();
    } catch (error) {
      // Log error without credential context
      console.error('[ERR_ESPN_001] ESPN API request failed');
      throw new Error('Unable to fetch league data');
    }

    // Determine scoring type - ESPN uses stat ID 53 for receptions
    let scoringType = 'standard';
    if (leagueData.settings?.scoringSettings?.scoringItems) {
      const scoringItems = leagueData.settings.scoringSettings.scoringItems;
      // Check for reception points (stat ID 53 in ESPN)
      const pprScore = scoringItems['53']?.points || scoringItems[53]?.points || scoringItems['53'] || scoringItems[53];
      
      console.log('ESPN Scoring - Reception points value:', pprScore);
      
      if (pprScore !== undefined && pprScore !== null) {
        if (pprScore === 1 || pprScore === 1.0) {
          scoringType = 'ppr';
        } else if (pprScore === 0.5) {
          scoringType = 'half_ppr';
        } else if (pprScore > 0) {
          scoringType = 'custom';
        }
      }
      
      console.log('Detected scoring type:', scoringType);
    }

    // Normalize IDs for robust matching (remove braces, hyphens, lowercase)
    const normalizeId = (id: string): string => {
      return (id || '').trim().toLowerCase().replace(/[{}\-]/g, '');
    };

    const normalizedSwid = normalizeId(swid);

    // Find the user's team with robust owner matching
    const userTeam = leagueData.teams?.find((team: any) => {
      const owners = (team.owners || []).map(normalizeId);
      const primaryOwner = normalizeId(team.primaryOwner || '');
      
      return owners.includes(normalizedSwid) || (primaryOwner && primaryOwner === normalizedSwid);
    });

    if (!userTeam) {
      throw new Error('Unable to find your team in this league');
    }

    // Get current week and matchup data
    const currentWeek = leagueData.scoringPeriodId || 1;
    const currentMatchupPeriod = leagueData.currentMatchupPeriod || currentWeek;

    // Fetch schedule data for matchups
    const scheduleUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${currentYear}/segments/0/leagues/${leagueId}?view=mMatchup&view=mMatchupScore`;
    const scheduleResponse = await fetch(scheduleUrl, {
      headers: {
        'Cookie': `espn_s2=${espn_s2}; SWID=${swid}`,
      },
    });

    let matchupData: any = {};
    if (scheduleResponse.ok) {
      const scheduleData = await scheduleResponse.json();
      // Find current week matchup for user's team
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

    // Upsert league data with user's team_id and matchup info
    const { data: leagueRecord, error: leagueError } = await supabase
      .from('connected_leagues')
      .upsert({
        user_id: user.id,
        platform: 'espn',
        league_id: leagueId,
        league_name: leagueData.settings.name,
        league_size: leagueData.settings.size,
        scoring_type: scoringType,
        scoring_settings: leagueData.settings.scoringSettings,
        user_team_id: userTeam.id.toString(),
        last_synced_at: new Date().toISOString(),
        ...matchupData,
      }, {
        onConflict: 'user_id,platform,league_id',
      })
      .select()
      .single();

    if (leagueError) {
      throw new Error('Unable to save league data');
    }

      // Collect all unique ESPN player IDs for normalization
      const allEspnPlayerIds = new Set<string>();
      for (const team of leagueData.teams || []) {
        for (const entry of team.roster?.entries || []) {
          if (entry.playerId) {
            allEspnPlayerIds.add(entry.playerId.toString());
          }
        }
      }

      // Build a map of ESPN ID -> normalized player info
      const normalizedMap = new Map<string, { player_id: string; player_name: string; position: string; team: string }>();
      
      if (allEspnPlayerIds.size > 0) {
        // Check which players already exist in normalized_players
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

      // For missing players, create normalized entries
      const playersToInsert = [];
      for (const team of leagueData.teams || []) {
        for (const entry of team.roster?.entries || []) {
          const espnId = entry.playerId?.toString();
          if (espnId && !normalizedMap.has(espnId)) {
            const player = entry.playerPoolEntry?.player;
            const playerName = player?.fullName || 'Unknown Player';
            const position = player?.defaultPositionId?.toString() || 'FLEX';
            const teamAbbr = player?.proTeamId ? getTeamAbbreviation(player.proTeamId) : 'FA';
            
            // Generate a normalized player_id (using ESPN ID as base)
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

      // Batch insert new players
      if (playersToInsert.length > 0) {
        await supabase
          .from('normalized_players')
          .upsert(playersToInsert, { onConflict: 'espn_id', ignoreDuplicates: true });
      }

      // Collect player stats for player_stats table
      const playerStatsToInsert: any[] = [];
      
      // Sync ALL teams in the league (not just the user's team)
      for (const team of leagueData.teams || []) {
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
              stat.statSourceId === 1 && stat.scoringPeriodId === leagueData.scoringPeriodId
            );
            projected = currentWeekStat?.appliedTotal || 0;
            
            // Remaining-week projections available from ESPN (often just current week)
            const weeksRemaining = Math.max(18 - leagueData.scoringPeriodId, 1);
            const remainingWeekProjections = player.stats
              .filter((stat: any) => 
                stat.statSourceId === 1 && 
                stat.scoringPeriodId >= leagueData.scoringPeriodId && 
                stat.scoringPeriodId <= 18
              )
              .map((stat: any) => stat.appliedTotal || 0);
            
            const availableWeeks = remainingWeekProjections.length;
            if (availableWeeks > 1) {
              // Trust ESPN when multiple future weeks are available
              rosProjection = remainingWeekProjections.reduce((sum: number, pts: number) => sum + pts, 0);
              ppgProjection = rosProjection / availableWeeks;
            } else if (availableWeeks === 1) {
              // Only current week available: use it as PPG and extrapolate ROS
              const w = remainingWeekProjections[0] || projected || 0;
              ppgProjection = w;
              rosProjection = w * weeksRemaining;
            } else if (projected > 0) {
              // No array entries returned: fallback to current week * weeks remaining
              ppgProjection = projected;
              rosProjection = projected * weeksRemaining;
            }
          }

          // Extract actual stats for current week if available
          if (player?.stats) {
            const currentWeekActual = player.stats.find((stat: any) => 
              stat.statSourceId === 0 && stat.scoringPeriodId === leagueData.scoringPeriodId
            );
            
            if (currentWeekActual?.stats) {
              const rawStats = currentWeekActual.stats;
              playerStatsToInsert.push({
                player_id: normalizedPlayer?.player_id || espnId || 'unknown',
                player_name: normalizedPlayer?.player_name || player?.fullName || 'Unknown',
                team: normalizedPlayer?.team || (player?.proTeamId ? getTeamAbbreviation(player.proTeamId) : null),
                position: normalizedPlayer?.position || player?.defaultPositionId?.toString() || 'FLEX',
                week: leagueData.scoringPeriodId,
                season: currentYear,
                passing_yards: rawStats['5'] || 0,
                passing_tds: rawStats['4'] || 0,
                interceptions: rawStats['20'] || 0,
                passing_completions: rawStats['3'] || 0,
                passing_attempts: rawStats['0'] || 0,
                rushing_yards: rawStats['24'] || 0,
                rushing_tds: rawStats['25'] || 0,
                rushing_attempts: rawStats['23'] || 0,
                receiving_yards: rawStats['42'] || 0,
                receiving_tds: rawStats['43'] || 0,
                receptions: rawStats['53'] || 0,
                receiving_targets: rawStats['58'] || 0,
                fumbles_lost: rawStats['72'] || 0,
                passing_2pt_conversions: rawStats['19'] || 0,
                rushing_2pt_conversions: rawStats['29'] || 0,
                receiving_2pt_conversions: rawStats['44'] || 0,
                source: 'espn',
                raw_data: currentWeekActual,
              });
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

        // Enrich roster with our valuations (schedule, injuries, form) when available
        const names = roster.map((p: any) => p.player_name).filter(Boolean);
        let latestWeek = leagueData.scoringPeriodId;
        const { data: latestWeekRow } = await supabase
          .from('player_valuations')
          .select('week')
          .eq('season', currentYear)
          .order('week', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latestWeekRow?.week) latestWeek = latestWeekRow.week;

        const { data: vals } = await supabase
          .from('player_valuations')
          .select('player_name, ppg_projection, ros_projection, is_bye_week, injury_status, injury_duration_weeks, next_3_weeks_projection, schedule_difficulty')
          .eq('season', currentYear)
          .eq('week', latestWeek)
          .in('player_name', names);
        const vMap = new Map((vals || []).map(v => [v.player_name, v]));

        const enrichedRoster = roster.map((p: any) => {
          const v = vMap.get(p.player_name);
          const ros = v && Number(v.ros_projection) > 0 ? Number(v.ros_projection) : p.ros_projection;
          const ppg = v && Number(v.ppg_projection) > 0 ? Number(v.ppg_projection) : p.ppg_projection;
          return {
            ...p,
            ros_projection: ros,
            ppg_projection: ppg,
            is_bye_week: v?.is_bye_week ?? p.is_bye_week,
            injury_status: v?.injury_status ?? p.injury_status,
            injury_duration_weeks: v?.injury_duration_weeks ?? p.injury_duration_weeks,
            schedule_difficulty: v?.schedule_difficulty ?? p.schedule_difficulty,
            next_3_weeks_projection: v?.next_3_weeks_projection ?? p.next_3_weeks_projection,
          };
        });

        // Calculate total projected points for starters only (same slots used in RosterView)
        const STARTER_SLOTS = [0, 2, 4, 6, 16, 17, 23];
        const totalProjected = enrichedRoster
          .filter((p: any) => STARTER_SLOTS.includes(p.slot))
          .reduce((sum: number, p: any) => sum + (p.projected || 0), 0);

        // Get team record
        const record = team.record?.overall || { wins: 0, losses: 0, ties: 0 };

        await supabase
          .from('user_teams')
          .upsert({
            league_id: leagueRecord.id,
            team_id: team.id.toString(),
            team_name: team.name || `${team.location} ${team.nickname}`,
            roster: enrichedRoster,
            wins: record.wins || 0,
            losses: record.losses || 0,
            ties: record.ties || 0,
            total_projected: totalProjected,
          }, {
            onConflict: 'league_id,team_id',
          });
      }

      // Batch insert all player stats
      if (playerStatsToInsert.length > 0) {
        console.log(`Inserting ${playerStatsToInsert.length} player stats for week ${leagueData.scoringPeriodId}`);
        await supabase
          .from('player_stats')
          .upsert(playerStatsToInsert, { 
            onConflict: 'player_id,week,season,source',
            ignoreDuplicates: false 
          });
      }

    return new Response(
      JSON.stringify({
        message: `Successfully synced ESPN league: ${leagueData.settings.name}`,
        league: {
          name: leagueData.settings.name,
          id: leagueId,
          platform: 'espn',
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    // Comprehensive error sanitization
    console.error('League sync error:', sanitizeError(error));
    
    // Return generic error messages without internal details
    let userMessage = 'Unable to sync your league. Please try again.';
    
    if (error.message?.includes('authenticate') || error.message?.includes('credentials') || error.message?.includes('store credentials')) {
      userMessage = 'Unable to authenticate. Please verify your credentials and try again.';
    } else if (error.message?.includes('team')) {
      userMessage = 'Unable to find your team. Please verify you are a member of this league.';
    } else if (error.message?.includes('Database') || error.message?.includes('save')) {
      userMessage = 'Unable to save league data. Please try again.';
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
