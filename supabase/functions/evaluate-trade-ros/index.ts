import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Positional weight multipliers
const POSITION_WEIGHTS: Record<string, number> = {
  'RB': 1.20,
  'WR': 1.15,
  'QB': 1.00,
  'TE': 0.90,
  'K': 0.30,
  'DEF': 0.25,
  'D/ST': 0.25,
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

    console.log('Evaluating ROS-weighted trade:', { teamAGives, teamBGives });

    // Fetch player valuations with ROS data
    const allPlayerIds = [...teamAGives, ...teamBGives];
    const { data: playerData, error: playerError } = await supabase
      .from('player_valuations')
      .select('*')
      .in('player_id', allPlayerIds);

    if (playerError) {
      console.error('Error fetching player data:', playerError);
      return new Response(
        JSON.stringify({ error: 'Unable to fetch player data' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const playerMap = new Map(playerData.map(p => [p.player_id, p]));

    // Fetch team positional strengths for depth adjustment
    const { data: strengths, error: strengthsError } = await supabase
      .from('team_positional_strengths')
      .select('*')
      .eq('league_id', leagueId)
      .in('team_id', [teamAId, teamBId]);

    const teamAStrengths = new Map<string, any>();
    const teamBStrengths = new Map<string, any>();

    for (const s of strengths || []) {
      const map = s.team_id === teamAId ? teamAStrengths : teamBStrengths;
      map.set(s.position, s);
    }

    // Calculate league average positional strengths
    const { data: allStrengths } = await supabase
      .from('team_positional_strengths')
      .select('position, pss')
      .eq('league_id', leagueId);

    const leagueAvgMap = new Map<string, number>();
    const positionCounts = new Map<string, number>();

    for (const s of allStrengths || []) {
      const currentSum = leagueAvgMap.get(s.position) || 0;
      const currentCount = positionCounts.get(s.position) || 0;
      leagueAvgMap.set(s.position, currentSum + s.pss);
      positionCounts.set(s.position, currentCount + 1);
    }

    // Convert sums to averages
    for (const [pos, sum] of leagueAvgMap.entries()) {
      const count = positionCounts.get(pos) || 1;
      leagueAvgMap.set(pos, sum / count);
    }

    // Helper: Calculate weighted ROS value
    const calculateWeightedValue = (player: any): number => {
      if (!player) return 0;
      
      // Base ROS value (0-100 scale)
      const rosPoints = player.ros_projection || 0;
      
      // Apply injury risk adjustment
      const injuryPenalty = (player.injury_risk || 0) * rosPoints * 0.10;
      
      // Apply bye week penalty
      const byePenalty = player.is_bye_week ? rosPoints * 0.05 : 0;
      
      // Calculate base value
      let baseValue = rosPoints - injuryPenalty - byePenalty;
      
      // Apply positional weighting
      const posWeight = POSITION_WEIGHTS[player.position] || 1.0;
      const weightedValue = baseValue * posWeight;
      
      return Math.max(0, weightedValue);
    };

    // Helper: Calculate depth adjustment
    const getDepthAdjustment = (
      player: any,
      teamStrengths: Map<string, any>,
      leagueAvg: number
    ): number => {
      const posStrength = teamStrengths.get(player.position);
      if (!posStrength) return 0;
      
      const teamPss = posStrength.pss;
      const diff = teamPss - leagueAvg;
      
      // Weaker than league average → boost incoming players
      if (diff < 0) {
        const severity = Math.abs(diff) / leagueAvg;
        return player.ros_projection * Math.min(severity * 0.10, 0.10); // Max 10% boost
      }
      
      // Stronger than league average → reduce incoming players
      if (diff > 0) {
        const severity = diff / leagueAvg;
        return -player.ros_projection * Math.min(severity * 0.05, 0.05); // Max 5% reduction
      }
      
      return 0;
    };

    // Calculate values for each side
    const teamAGivesDetails: any[] = [];
    const teamAReceivesDetails: any[] = [];
    const teamBGivesDetails: any[] = [];
    const teamBReceivesDetails: any[] = [];

    let teamAGivesTotal = 0;
    let teamAReceivesTotal = 0;

    for (const playerId of teamAGives) {
      const player = playerMap.get(playerId);
      if (player) {
        const weightedValue = calculateWeightedValue(player);
        const depthAdj = getDepthAdjustment(
          player,
          teamAStrengths,
          leagueAvgMap.get(player.position) || 0
        );
        
        teamAGivesTotal += weightedValue;
        teamAGivesDetails.push({
          player_name: player.player_name,
          position: player.position,
          ros_points: player.ros_projection,
          multiplier: POSITION_WEIGHTS[player.position] || 1.0,
          weighted_value: weightedValue,
          depth_adjustment: depthAdj,
        });
      }
    }

    for (const playerId of teamBGives) {
      const player = playerMap.get(playerId);
      if (player) {
        const weightedValue = calculateWeightedValue(player);
        const leagueAvg = leagueAvgMap.get(player.position) || 0;
        const depthAdj = getDepthAdjustment(player, teamAStrengths, leagueAvg);
        
        teamAReceivesTotal += weightedValue + depthAdj;
        teamAReceivesDetails.push({
          player_name: player.player_name,
          position: player.position,
          ros_points: player.ros_projection,
          multiplier: POSITION_WEIGHTS[player.position] || 1.0,
          weighted_value: weightedValue,
          depth_adjustment: depthAdj,
        });
      }
    }

    let teamBGivesTotal = 0;
    let teamBReceivesTotal = 0;

    for (const playerId of teamBGives) {
      const player = playerMap.get(playerId);
      if (player) {
        const weightedValue = calculateWeightedValue(player);
        const depthAdj = getDepthAdjustment(
          player,
          teamBStrengths,
          leagueAvgMap.get(player.position) || 0
        );
        
        teamBGivesTotal += weightedValue;
        teamBGivesDetails.push({
          player_name: player.player_name,
          position: player.position,
          ros_points: player.ros_projection,
          multiplier: POSITION_WEIGHTS[player.position] || 1.0,
          weighted_value: weightedValue,
          depth_adjustment: depthAdj,
        });
      }
    }

    for (const playerId of teamAGives) {
      const player = playerMap.get(playerId);
      if (player) {
        const weightedValue = calculateWeightedValue(player);
        const leagueAvg = leagueAvgMap.get(player.position) || 0;
        const depthAdj = getDepthAdjustment(player, teamBStrengths, leagueAvg);
        
        teamBReceivesTotal += weightedValue + depthAdj;
        teamBReceivesDetails.push({
          player_name: player.player_name,
          position: player.position,
          ros_points: player.ros_projection,
          multiplier: POSITION_WEIGHTS[player.position] || 1.0,
          weighted_value: weightedValue,
          depth_adjustment: depthAdj,
        });
      }
    }

    // Identify elite player (top 10% by ROS value for their position)
    const allPlayers = Array.from(playerMap.values());
    const positionTop10 = new Map<string, number>();

    for (const pos of Object.keys(POSITION_WEIGHTS)) {
      const posPlayers = allPlayers
        .filter(p => p.position === pos)
        .sort((a, b) => (b.ros_projection || 0) - (a.ros_projection || 0));
      
      const top10Index = Math.ceil(posPlayers.length * 0.10);
      if (posPlayers[top10Index]) {
        positionTop10.set(pos, posPlayers[top10Index].ros_projection || 0);
      }
    }

    // Find highest valued player in trade
    let bestPlayer: any = null;
    let bestValue = 0;

    for (const playerId of allPlayerIds) {
      const player = playerMap.get(playerId);
      if (player) {
        const value = calculateWeightedValue(player);
        if (value > bestValue) {
          bestValue = value;
          bestPlayer = player;
        }
      }
    }

    // Apply elite player bonus (+5% to receiving team)
    let eliteBonus = 0;
    let eliteBonusReceivedBy = null;

    if (bestPlayer) {
      const threshold = positionTop10.get(bestPlayer.position) || Infinity;
      if (bestPlayer.ros_projection >= threshold) {
        eliteBonus = bestValue * 0.05;
        
        if (teamBGives.includes(bestPlayer.player_id)) {
          teamAReceivesTotal += eliteBonus;
          eliteBonusReceivedBy = 'Team A';
        } else {
          teamBReceivesTotal += eliteBonus;
          eliteBonusReceivedBy = 'Team B';
        }
      }
    }

    // Calculate net gains
    const teamANet = teamAReceivesTotal - teamAGivesTotal;
    const teamBNet = teamBReceivesTotal - teamBGivesTotal;

    // Determine verdict
    const advantageTeam = teamANet > teamBNet ? teamAId : teamBId;
    const valueDifference = Math.abs(teamANet - teamBNet);
    const totalValue = teamAGivesTotal + teamBGivesTotal;
    const percentDiff = totalValue > 0 ? (valueDifference / totalValue) * 100 : 0;

    // Fair trade if within ±5%
    const isFair = percentDiff <= 5;

    const verdict = isFair ? 'Fair Trade' : 
                    teamANet > teamBNet ? `Side A Wins by +${valueDifference.toFixed(1)} Value Points` :
                    `Side B Wins by +${valueDifference.toFixed(1)} Value Points`;

    const result = {
      verdict,
      is_fair: isFair,
      advantage_team: advantageTeam,
      value_difference: valueDifference,
      percent_difference: percentDiff,
      elite_player_bonus: eliteBonus,
      elite_bonus_received_by: eliteBonusReceivedBy,
      best_player: bestPlayer ? {
        name: bestPlayer.player_name,
        position: bestPlayer.position,
        weighted_value: bestValue,
      } : null,
      team_a_breakdown: {
        gives: teamAGivesDetails,
        receives: teamAReceivesDetails,
        gives_total: teamAGivesTotal,
        receives_total: teamAReceivesTotal,
        net_gain: teamANet,
      },
      team_b_breakdown: {
        gives: teamBGivesDetails,
        receives: teamBReceivesDetails,
        gives_total: teamBGivesTotal,
        receives_total: teamBReceivesTotal,
        net_gain: teamBNet,
      },
    };

    // Save evaluation
    await supabase.from('trade_evaluations').insert({
      user_id: user.id,
      league_id: leagueId,
      my_team_id: teamAId,
      their_team_id: teamBId,
      my_players: teamAGives,
      their_players: teamBGives,
      verdict: isFair ? 'fair' : teamANet > 0 ? 'accept' : 'reject',
      grade: isFair ? 'B' : teamANet > 5 ? 'A' : teamANet > 0 ? 'B' : 'C',
      confidence: 85,
      ros_points_delta: teamANet,
      next_3_weeks_delta: teamANet * 0.3,
      best_player_bonus_applied: eliteBonus > 0,
      summary: verdict,
    });

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error evaluating trade:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Unable to evaluate trade' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
