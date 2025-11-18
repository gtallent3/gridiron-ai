import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Standard starting lineup slots by position
const STARTING_SLOTS: Record<string, number> = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  FLEX: 1, // RB/WR/TE
  K: 1,
  DST: 1,
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { leagueId, teamAId, teamBId, teamAGives, teamBGives } = await req.json();

    if (!leagueId || !teamAId || !teamBId || !teamAGives || !teamBGives) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch player rankings (all stats and values)
    const { data: playerRankings, error: rankingsError } = await supabase
      .from('player_rankings')
      .select('*')
      .eq('season', 2025);

    if (rankingsError) {
      console.error('Error fetching player rankings:', rankingsError);
      return new Response(
        JSON.stringify({ error: 'Unable to fetch player data' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const rankingsMap = new Map<string, any>();
    for (const pr of playerRankings || []) {
      rankingsMap.set(pr.player_id, pr);
    }

    // Fetch team rosters
    const { data: teams, error: teamsError } = await supabase
      .from('user_teams')
      .select('*')
      .eq('league_id', leagueId)
      .in('team_id', [teamAId, teamBId]);

    if (teamsError || !teams || teams.length !== 2) {
      return new Response(
        JSON.stringify({ error: 'Unable to fetch team rosters' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const teamA = teams.find(t => t.team_id === teamAId);
    const teamB = teams.find(t => t.team_id === teamBId);

    if (!teamA || !teamB) {
      return new Response(
        JSON.stringify({ error: 'Team data not found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse rosters
    const teamARoster = Array.isArray(teamA.roster) ? teamA.roster : [];
    const teamBRoster = Array.isArray(teamB.roster) ? teamB.roster : [];

    // Evaluate trade based on starting lineup impact
    const evaluation = evaluateTradeByStartingLineup(
      teamARoster,
      teamBRoster,
      teamAGives,
      teamBGives,
      rankingsMap,
      teamAId,
      teamBId
    );

    // Note: trade_evaluations table was removed - evaluation computed but not stored

    return new Response(
      JSON.stringify(evaluation),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error evaluating trade:', error);
    return new Response(
      JSON.stringify({ error: 'Unable to evaluate trade' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

interface Player {
  player_id: string;
  canonical_player_id: string;
  player_name: string;
  position: string;
  ppg_projection: number;
  value_score: number;
}

function evaluateTradeByStartingLineup(
  teamARoster: any[],
  teamBRoster: any[],
  teamAGives: string[],
  teamBGives: string[],
  rankingsMap: Map<string, any>,
  teamAId: string,
  teamBId: string
) {
  // Convert rosters to player arrays with values from player_rankings
  const getPlayerData = (roster: any[]): Player[] => {
    return roster.map(p => {
      // Keep the platform-specific ID as the main identifier (for filtering trades)
      const platformId = String(p.player_id || p.playerId || p.id || '');
      // Use canonical_player_id for looking up rankings data
      const canonicalId = String(p.canonical_player_id || '');
      const ranking = rankingsMap.get(canonicalId);
      
      // Use avg_projected_ppg_ros from player_rankings
      const ppg = ranking?.avg_projected_ppg_ros || 0;
      const tradeValue = ranking?.trade_value || 0;
      
      return {
        player_id: platformId,  // Keep platform ID for filtering
        canonical_player_id: canonicalId,  // Store for reference
        player_name: p.player_name || p.playerName || p.name || ranking?.player_name || 'Unknown',
        position: String(p.position || ranking?.position || '').toUpperCase(),
        ppg_projection: ppg,
        value_score: tradeValue,
      };
    }).filter(p => p.player_id);
  };

  const teamAPlayers = getPlayerData(teamARoster);
  const teamBPlayers = getPlayerData(teamBRoster);

  // Calculate starting lineup before trade
  const teamAStartingBefore = calculateStartingLineup(teamAPlayers);
  const teamBStartingBefore = calculateStartingLineup(teamBPlayers);

  // Apply trade
  const teamAAfter = teamAPlayers.filter(p => !teamAGives.includes(p.player_id));
  const teamBAfter = teamBPlayers.filter(p => !teamBGives.includes(p.player_id));

  // Add received players
  for (const playerId of teamBGives) {
    const player = teamBPlayers.find(p => p.player_id === playerId);
    if (player) teamAAfter.push(player);
  }

  for (const playerId of teamAGives) {
    const player = teamAPlayers.find(p => p.player_id === playerId);
    if (player) teamBAfter.push(player);
  }

  // Calculate starting lineup after trade
  const teamAStartingAfter = calculateStartingLineup(teamAAfter);
  const teamBStartingAfter = calculateStartingLineup(teamBAfter);

  // Calculate PPG impact (only starting lineup)
  const teamAPpgChange = teamAStartingAfter.totalPpg - teamAStartingBefore.totalPpg;
  const teamBPpgChange = teamBStartingAfter.totalPpg - teamBStartingBefore.totalPpg;

  // Determine if trade is acceptable (both teams should improve or be close)
  const isAcceptable = teamBPpgChange >= -0.5; // Team B shouldn't lose more than 0.5 PPG
  const isFairTrade = Math.abs(teamAPpgChange - teamBPpgChange) < 1.5;

  // Grade based on YOUR (Team A) starting lineup improvement (PPG)
  let grade = 'F';
  if (teamAPpgChange >= 2.0) grade = 'A+';
  else if (teamAPpgChange >= 1.5) grade = 'A';
  else if (teamAPpgChange >= 1.0) grade = 'A-';
  else if (teamAPpgChange >= 0.7) grade = 'B+';
  else if (teamAPpgChange >= 0.5) grade = 'B';
  else if (teamAPpgChange >= 0.3) grade = 'B-';
  else if (teamAPpgChange >= 0.15) grade = 'C+';
  else if (teamAPpgChange > 0) grade = 'C';
  else if (teamAPpgChange >= -0.3) grade = 'D';
  else grade = 'F';

  // Build explanation
  const tradedPlayersOut = teamAGives.map(id => teamAPlayers.find(p => p.player_id === id)?.player_name).filter(Boolean);
  const tradedPlayersIn = teamBGives.map(id => teamBPlayers.find(p => p.player_id === id)?.player_name).filter(Boolean);

  let explanation = `Your starting lineup ${teamAPpgChange > 0 ? 'gains' : 'loses'} ${Math.abs(teamAPpgChange).toFixed(2)} PPG. `;
  explanation += `Their starting lineup ${teamBPpgChange > 0 ? 'gains' : 'loses'} ${Math.abs(teamBPpgChange).toFixed(2)} PPG. `;

  if (!isAcceptable) {
    explanation += `⚠️ The other team loses too much value - they likely won't accept this trade. `;
  } else if (isFairTrade) {
    explanation += `✓ This is a fair trade that benefits both teams. `;
  }

  // Highlight position changes
  const positionChanges = analyzePositionChanges(
    teamAStartingBefore,
    teamAStartingAfter,
    teamAGives,
    teamBGives,
    teamAPlayers,
    teamBPlayers
  );

  if (positionChanges.length > 0) {
    explanation += positionChanges.slice(0, 2).join(' ');
  }

  // Get player details for display
  const teamAGivesPlayers = teamAGives.map(id => {
    const player = teamAPlayers.find(p => p.player_id === id);
    return player ? {
      id: player.player_id,
      name: player.player_name,
      position: player.position,
      trade_value: player.value_score || 0,
      ppg_projection: player.ppg_projection || 0,
    } : null;
  }).filter(Boolean);

  const teamBGivesPlayers = teamBGives.map(id => {
    const player = teamBPlayers.find(p => p.player_id === id);
    return player ? {
      id: player.player_id,
      name: player.player_name,
      position: player.position,
      trade_value: player.value_score || 0,
      ppg_projection: player.ppg_projection || 0,
    } : null;
  }).filter(Boolean);

  const teamAGivesValue = teamAGivesPlayers.reduce((sum, p) => sum + (p?.trade_value || 0), 0);
  const teamBGivesValue = teamBGivesPlayers.reduce((sum, p) => sum + (p?.trade_value || 0), 0);

  // Best Player Bonus - difference between best overall player and best player on the other side
  const teamAGivesFiltered = teamAGivesPlayers.filter(p => p !== null);
  const teamBGivesFiltered = teamBGivesPlayers.filter(p => p !== null);
  
  let bestPlayerBonus = 0;
  let bestPlayerReceivedBy = teamAId;
  
  if (teamAGivesFiltered.length > 0 && teamBGivesFiltered.length > 0) {
    // Find best player from each side
    const bestFromA = teamAGivesFiltered.reduce((best, p) => 
      p.trade_value > best.trade_value ? p : best
    );
    const bestFromB = teamBGivesFiltered.reduce((best, p) => 
      p.trade_value > best.trade_value ? p : best
    );
    
    // The bonus is the difference between the two best players
    bestPlayerBonus = Math.abs(bestFromA.trade_value - bestFromB.trade_value);
    
    // Determine who receives the overall best player
    bestPlayerReceivedBy = bestFromA.trade_value > bestFromB.trade_value ? teamBId : teamAId;
  }

  // Adjust values with best player bonus (team receiving best player gets the bonus)
  let adjustedTeamAValue = teamBGivesValue;
  
  if (bestPlayerReceivedBy === teamAId) {
    adjustedTeamAValue += bestPlayerBonus; // Team A gets bonus for receiving best player
  }

  // Calculate value difference based on trade values with best player bonus
  const netValueDiff = adjustedTeamAValue - teamAGivesValue; // Positive means Team A gains value
  const totalTradeValue = teamAGivesValue + teamBGivesValue;
  const percentDifference = totalTradeValue > 0 
    ? (Math.abs(netValueDiff) / totalTradeValue) * 100 
    : 0;

  const result = {
    trade_grade: grade,
    advantage_team: netValueDiff > 0 ? teamAId : teamBId,
    value_difference: Math.abs(netValueDiff),
    percent_difference: percentDifference,
    best_player_received_by: bestPlayerReceivedBy,
    best_player_bonus: bestPlayerBonus,
    explanation,
    is_acceptable: isAcceptable,
    is_fair: isFairTrade,
    audit: {
      teamA_out: teamAGivesValue,
      teamA_in: adjustedTeamAValue,  // Include best player bonus
      teamA_net: adjustedTeamAValue - teamAGivesValue,  // Net with bonus
      teamB_out: teamBGivesValue,
      teamB_in: teamAGivesValue,
      teamB_net: teamAGivesValue - teamBGivesValue,
      teamA_starting_ppg_before: teamAStartingBefore.totalPpg,
      teamA_starting_ppg_after: teamAStartingAfter.totalPpg,
      teamA_ppg_change: teamAPpgChange,
      teamB_starting_ppg_before: teamBStartingBefore.totalPpg,
      teamB_starting_ppg_after: teamBStartingAfter.totalPpg,
      teamB_ppg_change: teamBPpgChange,
    },
    players_traded: {
      teamA_gives: teamAGivesPlayers,
      teamB_gives: teamBGivesPlayers,
    },
    starting_lineup_breakdown: {
      teamA_before: teamAStartingBefore.breakdown,
      teamA_after: teamAStartingAfter.breakdown,
      teamB_before: teamBStartingBefore.breakdown,
      teamB_after: teamBStartingAfter.breakdown,
    },
    ros_points_delta: teamAPpgChange * 10, // Convert to ~season estimate
    next_3_weeks_delta: teamAPpgChange * 3,
    confidence: isAcceptable ? 85 : 65,
    verdict: teamAPpgChange > 0 && isAcceptable ? 'accept' : 'reject',
    summary: explanation,
  };

  return result;
}

function calculateStartingLineup(players: Player[]) {
  // Group players by position
  const byPosition: Record<string, Player[]> = {
    QB: [],
    RB: [],
    WR: [],
    TE: [],
    K: [],
    DST: [],
  };

  for (const p of players) {
    const pos = p.position.toUpperCase();
    if (byPosition[pos]) {
      byPosition[pos].push(p);
    }
  }

  // Sort each position by PPG projection (highest first)
  for (const pos in byPosition) {
    byPosition[pos].sort((a, b) => b.ppg_projection - a.ppg_projection);
  }

  // Select starters
  const starters: Player[] = [];
  const breakdown: Record<string, number> = {};

  // QB, TE, K, DST - take top 1
  for (const pos of ['QB', 'TE', 'K', 'DST']) {
    if (byPosition[pos][0]) {
      starters.push(byPosition[pos][0]);
      breakdown[pos] = byPosition[pos][0].ppg_projection;
    } else {
      breakdown[pos] = 0;
    }
  }

  // RB - take top 2
  for (let i = 0; i < 2; i++) {
    if (byPosition.RB[i]) {
      starters.push(byPosition.RB[i]);
    }
  }
  breakdown.RB = byPosition.RB.slice(0, 2).reduce((sum, p) => sum + p.ppg_projection, 0);

  // WR - take top 2
  for (let i = 0; i < 2; i++) {
    if (byPosition.WR[i]) {
      starters.push(byPosition.WR[i]);
    }
  }
  breakdown.WR = byPosition.WR.slice(0, 2).reduce((sum, p) => sum + p.ppg_projection, 0);

  // FLEX - best remaining RB/WR/TE
  const flexCandidates = [
    ...(byPosition.RB[2] ? [byPosition.RB[2]] : []),
    ...(byPosition.WR[2] ? [byPosition.WR[2]] : []),
    ...(byPosition.TE[1] ? [byPosition.TE[1]] : []),
  ].sort((a, b) => b.ppg_projection - a.ppg_projection);

  if (flexCandidates[0]) {
    starters.push(flexCandidates[0]);
    breakdown.FLEX = flexCandidates[0].ppg_projection;
  } else {
    breakdown.FLEX = 0;
  }

  const totalPpg = starters.reduce((sum, p) => sum + p.ppg_projection, 0);

  return {
    starters,
    totalPpg,
    breakdown,
  };
}

function analyzePositionChanges(
  beforeLineup: any,
  afterLineup: any,
  teamAGives: string[],
  teamBGives: string[],
  teamAPlayers: Player[],
  teamBPlayers: Player[]
): string[] {
  const notes: string[] = [];

  // Check if trading away a starter
  const givingAwayStarters = teamAGives.filter(id => 
    beforeLineup.starters.some((s: Player) => s.player_id === id)
  );

  if (givingAwayStarters.length > 0) {
    const player = teamAPlayers.find(p => p.player_id === givingAwayStarters[0]);
    if (player) {
      notes.push(`⚠️ You're trading away ${player.player_name}, a current starter.`);
    }
  }

  // Check if receiving upgrades at weak positions
  const posChanges: Record<string, number> = {};
  for (const pos in afterLineup.breakdown) {
    const change = afterLineup.breakdown[pos] - beforeLineup.breakdown[pos];
    if (Math.abs(change) > 0.5) {
      posChanges[pos] = change;
    }
  }

  for (const pos in posChanges) {
    const change = posChanges[pos];
    if (change > 0.5) {
      notes.push(`✓ Your ${pos} position improves by ${change.toFixed(2)} PPG.`);
    } else if (change < -0.5) {
      notes.push(`⚠️ Your ${pos} position weakens by ${Math.abs(change).toFixed(2)} PPG.`);
    }
  }

  return notes;
}
