import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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

    // Build canonical player map using ESPN IDs
    const canonicalMap = new Map<string, { id: string; player_name: string; position: string; team: string; sleeper_id: string | null; nfl_id: string | null }>();
    
    if (allEspnPlayerIds.size > 0) {
      const { data: canonicalPlayers } = await supabase
        .from('canonical_players')
        .select('id, espn_id, sleeper_id, nfl_id, player_name, position, team')
        .in('espn_id', Array.from(allEspnPlayerIds));
      
      if (canonicalPlayers && canonicalPlayers.length > 0) {
        for (const p of canonicalPlayers) {
          if (p.espn_id) {
            canonicalMap.set(p.espn_id, {
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
    const { data: allCanonicalPlayers } = await supabase
      .from('canonical_players')
      .select('id, espn_id, sleeper_id, nfl_id, player_name, position, team');
    
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
    
    // Match players by ESPN ID or name, and update canonical players with ESPN IDs
    const playersToInsert = [];
    const playersToUpdate = [];
    
    for (const team of espnLeagueData.teams || []) {
      for (const entry of team.roster?.entries || []) {
        const espnId = entry.playerId?.toString();
        if (espnId && !canonicalMap.has(espnId)) {
          const player = entry.playerPoolEntry?.player;
          const playerName = player?.fullName || 'Unknown Player';
          const position = player?.defaultPositionId?.toString() || 'FLEX';
          const teamAbbr = player?.proTeamId ? getTeamAbbreviation(player.proTeamId) : 'FA';
          
          // Try to match by name
          const normalizedName = playerName.toLowerCase().replace(/[^a-z]/g, '');
          const matchesByName = canonicalByName.get(normalizedName) || [];
          
          // Find best match by position and team
          let bestMatch = matchesByName.find(p => p.position === position && p.team === teamAbbr);
          if (!bestMatch && matchesByName.length > 0) {
            bestMatch = matchesByName.find(p => p.position === position);
          }
          if (!bestMatch && matchesByName.length > 0) {
            bestMatch = matchesByName[0];
          }
          
          if (bestMatch && !bestMatch.espn_id) {
            // Update existing canonical player with ESPN ID
            playersToUpdate.push({
              id: bestMatch.id,
              espn_id: espnId,
            });
            
            canonicalMap.set(espnId, {
              id: bestMatch.id,
              player_name: bestMatch.player_name,
              position: bestMatch.position,
              team: bestMatch.team,
              sleeper_id: bestMatch.sleeper_id,
              nfl_id: bestMatch.nfl_id,
            });
          } else if (!bestMatch) {
            // Create new canonical player
            playersToInsert.push({
              espn_id: espnId,
              player_name: playerName,
              position: position,
              team: teamAbbr,
              sleeper_id: null,
              nfl_id: null,
            });
          }
        }
      }
    }

    // Update canonical players with ESPN IDs
    if (playersToUpdate.length > 0) {
      for (const update of playersToUpdate) {
        await supabase
          .from('canonical_players')
          .update({ espn_id: update.espn_id })
          .eq('id', update.id);
      }
      console.log(`Updated ${playersToUpdate.length} canonical players with ESPN IDs`);
    }

    // Insert new canonical players
    if (playersToInsert.length > 0) {
      const { data: inserted } = await supabase
        .from('canonical_players')
        .upsert(playersToInsert, { onConflict: 'espn_id' })
        .select('id, espn_id, sleeper_id, nfl_id, player_name, position, team');
      
      if (inserted) {
        for (const p of inserted) {
          if (p.espn_id) {
            canonicalMap.set(p.espn_id, {
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
      console.log(`Inserted ${inserted?.length || 0} new canonical players`);
    }
    
    // Rebuild canonical IDs list and fetch stats from player_pool_v2
    const finalCanonicalIds = Array.from(new Set(Array.from(canonicalMap.values()).map(p => p.id)));
    
    const { data: playerPoolStats } = await supabase
      .from('player_pool_v2')
      .select('canonical_player_id, week, season, passing_yards, passing_tds, passing_ints, rushing_yards, rushing_tds, receptions, receiving_yards, receiving_tds, projected_fp, actual_fp')
      .in('canonical_player_id', finalCanonicalIds)
      .eq('season', currentYear);
    
    const playerPoolMap = new Map((playerPoolStats || []).map(p => [`${p.canonical_player_id}_${p.week}`, p]));
    console.log(`Loaded stats for ${playerPoolStats?.length || 0} player-week combinations from player_pool_v2`);
    
    
    // Convert league scoring settings to simplified format for calculator
    const scoringSettings: any = {};
    if (updatedLeague.scoring_settings?.scoringItems) {
      const items = updatedLeague.scoring_settings.scoringItems;
      scoringSettings.passing_yards = items['3']?.points || items[3]?.points || 0.04;
      scoringSettings.passing_tds = items['4']?.points || items[4]?.points || 4;
      scoringSettings.interceptions = items['20']?.points || items[20]?.points || -2;
      scoringSettings.rushing_yards = items['24']?.points || items[24]?.points || 0.1;
      scoringSettings.rushing_tds = items['25']?.points || items[25]?.points || 6;
      scoringSettings.receptions = items['53']?.points || items[53]?.points || 1;
      scoringSettings.receiving_yards = items['42']?.points || items[42]?.points || 0.1;
      scoringSettings.receiving_tds = items['43']?.points || items[43]?.points || 6;
    }

    // Sync all teams
    for (const team of espnLeagueData.teams || []) {
      const rosterPromises = (team.roster?.entries || []).map(async (entry: any) => {
        const player = entry.playerPoolEntry?.player;
        const espnId = entry.playerId?.toString();
        const canonical = espnId ? canonicalMap.get(espnId) : null;
        
        // Calculate projected and actual points using league scoring from player_pool_v2
        let projected = 0;
        let actual = 0;
        
        if (canonical) {
          // Get current week projection
          const projKey = `${canonical.id}_${currentWeek}`;
          const projStats = playerPoolMap.get(projKey);
          if (projStats) {
            projected = calculateFantasyPoints({
              passing_yards: projStats.passing_yards,
              passing_tds: projStats.passing_tds,
              passing_ints: projStats.passing_ints,
              rushing_yards: projStats.rushing_yards,
              rushing_tds: projStats.rushing_tds,
              receptions: projStats.receptions,
              receiving_yards: projStats.receiving_yards,
              receiving_tds: projStats.receiving_tds,
            }, scoringSettings);
          }
          
          // Get last week's actual
          if (currentWeek > 1) {
            const actualKey = `${canonical.id}_${currentWeek - 1}`;
            const actualStats = playerPoolMap.get(actualKey);
            if (actualStats) {
              actual = calculateFantasyPoints({
                passing_yards: actualStats.passing_yards,
                passing_tds: actualStats.passing_tds,
                passing_ints: actualStats.passing_ints,
                rushing_yards: actualStats.rushing_yards,
                rushing_tds: actualStats.rushing_tds,
                receptions: actualStats.receptions,
                receiving_yards: actualStats.receiving_yards,
                receiving_tds: actualStats.receiving_tds,
              }, scoringSettings);
            }
          }
        }
        
        return {
          player_id: espnId || 'unknown',
          canonical_player_id: canonical?.id || null,
          espn_id: espnId,
          sleeper_id: canonical?.sleeper_id || null,
          nfl_id: canonical?.nfl_id || null,
          player_name: canonical?.player_name || player?.fullName,
          position: canonical?.position || player?.defaultPositionId,
          team: canonical?.team || (player?.proTeamId ? getTeamAbbreviation(player.proTeamId) : null),
          slot: entry.lineupSlotId,
          projected,
          actual,
        };
      });
      
      const roster = await Promise.all(rosterPromises);

      // Upsert roster to user_teams
      const STARTER_SLOTS = [0, 2, 4, 6, 16, 17, 23];
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
        }, {
          onConflict: 'league_id,team_id',
        });
    }

    // Fetch projections for remaining weeks
    console.log(`Fetching projections for weeks ${currentWeek} to 18`);
    try {
      const projectionResponse = await fetch(`${supabaseUrl}/functions/v1/fetch-espn-projections`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          leagueId: updatedLeague.id,
          startWeek: currentWeek,
          endWeek: 18,
        }),
      });

      if (projectionResponse.ok) {
        const projData = await projectionResponse.json();
        console.log(`Successfully fetched ${projData.projections_inserted || 0} projections`);
      } else {
        console.error('Failed to fetch projections:', await projectionResponse.text());
      }
    } catch (projError) {
      console.error('Error fetching projections:', projError);
      // Don't fail the resync if projections fail
    }

    // Also fetch waiver/free agent list for current week and populate waiver_wire_players
    try {
      const swidCookie = swid?.startsWith('{') ? swid : `{${swid}}`;
      
      // Fetch waiver players with BOTH projections (sourceId=1) AND actuals (sourceId=0)
      // ESPN often doesn't provide projections, so we'll try to get actuals as fallback
      const waiverFilter = {
        players: {
          filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
          filterStatsForExternalIds: { value: [currentYear] },
          filterStatsForSourceIds: { value: [0, 1] }, // 0=actuals, 1=projections
          filterStatsForTopScoringPeriodIds: { value: 2, additionalValue: [currentWeek] },
          limit: 2000,
          sortPercOwned: { sortPriority: 1, sortAsc: false }
        }
      };
      const waiverUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${currentYear}/segments/0/leagues/${leagueData.league_id}?scoringPeriodId=${currentWeek}&view=kona_player_info`;
      const waiverResp = await fetch(waiverUrl, {
        headers: {
          'Cookie': `SWID=${swidCookie}; espn_s2=${espn_s2}`,
          'X-Fantasy-Filter': JSON.stringify(waiverFilter),
        },
      });
      let waiverPlayers: any[] = [];
      if (waiverResp.ok) {
        const wct = waiverResp.headers.get('content-type') || '';
        const wraw = await waiverResp.text();
        if (wct.includes('application/json') && !wraw.trim().startsWith('<')) {
          const wjson = JSON.parse(wraw);
          waiverPlayers = wjson.players || [];
        } else {
          console.error('Resync: Non-JSON waiver response from ESPN');
        }
      }
      const waiverRows: any[] = [];
      for (const playerData of waiverPlayers) {
        const player = playerData.player;
        const espnId = player?.id?.toString();
        if (!espnId) continue;
        
        let canonical = canonicalMap.get(espnId) || null;
        if (!canonical) {
          // Create missing canonical player
          const newPlayer = {
            espn_id: espnId,
            player_name: player?.fullName || 'Unknown',
            position: player?.defaultPositionId?.toString() || 'FLEX',
            team: player?.proTeamId ? getTeamAbbreviation(player.proTeamId) : 'FA',
          };
          const { data: inserted } = await supabase
            .from('canonical_players')
            .upsert([newPlayer], { onConflict: 'espn_id' })
            .select('id, espn_id, sleeper_id, nfl_id, player_name, position, team')
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
            canonicalMap.set(espnId, canonical);
          }
        }
        
        if (!canonical) continue;
        
        const ownership = playerData.ownership || {};
        const waiverStatus = playerData.status === 'FREEAGENT' ? 'FREEAGENT' : 'WAIVERS';
        
        // Try to get projection (sourceId=1) first, fallback to actuals (sourceId=0)
        // Relaxed seasonId check - ESPN often omits it for projections
        let weekProjection = player.stats?.find((stat: any) =>
          stat.statSourceId === 1 && 
          stat.scoringPeriodId === currentWeek && 
          (stat.seasonId == null || stat.seasonId === currentYear)
        );
        
        // If no projection available, use actual stats for current week
        if (!weekProjection || !weekProjection.stats || Object.keys(weekProjection.stats || {}).length === 0) {
          weekProjection = player.stats?.find((stat: any) =>
            stat.statSourceId === 0 && 
            stat.scoringPeriodId === currentWeek && 
            (stat.seasonId == null || stat.seasonId === currentYear)
          );
        }
        
        const waiverRow: any = {
          league_id: updatedLeague.id,
          espn_league_id: leagueData.league_id,
          player_id: canonical.id,
          player_name: canonical.player_name,
          position: canonical.position,
          team: canonical.team,
          season: currentYear,
          week: currentWeek,
          waiver_status: waiverStatus,
          percent_owned: ownership.percentOwned || 0,
          percent_started: ownership.percentStarted || 0,
          provider_ids: { espn: espnId },
          updated_at: new Date().toISOString(),
        };
        
        // Add projection/actual stats if available
        if (weekProjection?.stats || weekProjection?.appliedStats) {
          waiverRow.stats = weekProjection.stats || {};
          waiverRow.applied_breakdown = weekProjection.appliedStats || {};
          
          // Calculate projected_fp: prefer appliedTotal, fallback to summing appliedStats
          let projected_fp = weekProjection.appliedTotal;
          if (projected_fp == null && Object.keys(weekProjection.appliedStats || {}).length > 0) {
            projected_fp = Object.values(weekProjection.appliedStats).reduce(
              (sum: number, val: any) => sum + (typeof val === 'number' ? val : parseFloat(val || '0') || 0),
              0
            );
            console.log(`Calculated projected_fp from appliedStats for ${canonical.player_name}: ${projected_fp}`);
          }
          
          waiverRow.projected_fp = projected_fp || 0;
          waiverRow.confidence = weekProjection.statSourceId === 1 ? 0.8 : 1.0;
          waiverRow.source = weekProjection.statSourceId === 1 ? 'espn_projection' : 'espn_actual';
          waiverRow.last_updated = new Date().toISOString();
        } else {
          console.log(`No stats available for waiver player: ${canonical.player_name} (ESPN ID: ${espnId})`);
        }
        
        waiverRows.push(waiverRow);
      }
      
      // Upsert to waiver_wire_players table
      if (waiverRows.length > 0) {
        await supabase.from('waiver_wire_players').upsert(waiverRows, { 
          onConflict: 'league_id,season,week,player_id', 
          ignoreDuplicates: false 
        });
        console.log(`Resync: inserted ${waiverRows.length} waiver players for week ${currentWeek}`);
        
        // Also upsert to projected_player_stats so UI can query it
        const projectedRows = waiverRows
          .filter(row => row.projected_fp > 0)
          .map(row => ({
            player_id: row.player_id,
            player_name: row.player_name,
            team: row.team,
            position: row.position,
            season: row.season,
            week: row.week,
            source: row.source || 'espn_projection',
            stats: row.stats || {},
            applied_breakdown: row.applied_breakdown || {},
            projected_fp: row.projected_fp,
            waiver_status: row.waiver_status,
            percent_owned: row.percent_owned || 0,
            percent_started: row.percent_started || 0,
            provider_ids: row.provider_ids || {},
            confidence: row.confidence || 0.8,
            last_updated: new Date().toISOString(),
          }));
        
        if (projectedRows.length > 0) {
          await supabase.from('projected_player_stats').upsert(projectedRows, {
            onConflict: 'player_id,season,week,source',
            ignoreDuplicates: false
          });
          console.log(`Resync: also inserted ${projectedRows.length} waiver projections into projected_player_stats`);
        }
      }
    } catch (waiverErr) {
      console.error('Resync: waiver sync error', waiverErr);
    }

    // Player data already synced from rosters and waivers above
    // post-sync-compute will map to sleeper_projections and nfl_fantasy_points
    console.log('Player data synced from rosters and waivers');

    // Trigger post-sync compute for trade intelligence
    try {
      console.log('Triggering post-sync compute for trade intelligence...');
      await supabase.functions.invoke('post-sync-compute', {
        body: { leagueId: leagueId },
        headers: { Authorization: req.headers.get('Authorization')! },
      });
      console.log('Post-sync compute triggered successfully');
    } catch (computeErr) {
      // Don't fail the resync if compute fails
      console.error('Post-sync compute failed (non-critical):', computeErr);
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
