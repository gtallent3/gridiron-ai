import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // Fetch player values from cache
    const { data: playerValues, error: valuesError } = await supabase
      .from('player_value_cache')
      .select('*')
      .eq('league_id', leagueId);

    if (valuesError) {
      console.error('Error fetching player values:', valuesError);
      return new Response(
        JSON.stringify({ error: 'Unable to fetch player data' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const valueMap = new Map<string, any>();
    for (const pv of playerValues || []) {
      valueMap.set(pv.player_id, pv);
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
      valueMap,
      teamAId,
      teamBId
    );

    // Save evaluation
    const { error: saveError } = await supabase
      .from('trade_evaluations')
      .insert({
        user_id: user.id,
        league_id: leagueId,
        my_team_id: teamAId,
        their_team_id: teamBId,
        my_players: teamAGives,
        their_players: teamBGives,
        verdict: evaluation.verdict,
        grade: evaluation.trade_grade,
        confidence: evaluation.confidence,
        ros_points_delta: evaluation.ros_points_delta,
        next_3_weeks_delta: evaluation.next_3_weeks_delta,
        summary: evaluation.explanation,
      });

    if (saveError) console.error('Error saving evaluation:', saveError);

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
  valueMap: Map<string, any>,
  teamAId: string,
  teamBId: string
) {
  // Convert rosters to player arrays with values
  const getPlayerData = (roster: any[]): Player[] => {
    return roster.map(p => {
      const playerId = String(p.player_id || p.playerId || p.id || '');
      const value = valueMap.get(playerId);
      
      // Calculate PPG from ROS projection (assuming ~10 weeks remaining on average)
      const rosProj = value?.projected_fp_ros || 0;
      const ppg = p.ppg_projection || (rosProj > 0 ? rosProj / 10 : 0);
      
      return {
        player_id: playerId,
        player_name: p.player_name || p.playerName || p.name || 'Unknown',
        position: String(p.position || '').toUpperCase(),
        ppg_projection: ppg,
        value_score: value?.value_score || 0,
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

  const result = {
    trade_grade: grade,
    advantage_team: teamAPpgChange > teamBPpgChange ? teamAId : teamBId,
    value_difference: Math.abs(teamAPpgChange - teamBPpgChange),
    percent_difference: ((Math.abs(teamAPpgChange - teamBPpgChange) / (teamAStartingBefore.totalPpg + teamBStartingBefore.totalPpg)) * 100),
    explanation,
    is_acceptable: isAcceptable,
    is_fair: isFairTrade,
    audit: {
      teamA_starting_ppg_before: teamAStartingBefore.totalPpg,
      teamA_starting_ppg_after: teamAStartingAfter.totalPpg,
      teamA_ppg_change: teamAPpgChange,
      teamB_starting_ppg_before: teamBStartingBefore.totalPpg,
      teamB_starting_ppg_after: teamBStartingAfter.totalPpg,
      teamB_ppg_change: teamBPpgChange,
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
