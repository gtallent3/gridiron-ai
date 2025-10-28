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

    if (valuesError) throw valuesError;

    const valueMap = new Map<string, any>();
    for (const pv of playerValues || []) {
      valueMap.set(pv.player_id, pv);
    }

    // Fetch positional strengths
    const { data: strengths, error: strengthsError } = await supabase
      .from('team_positional_strengths')
      .select('*')
      .eq('league_id', leagueId)
      .in('team_id', [teamAId, teamBId]);

    if (strengthsError) throw strengthsError;

    const teamAStrengths = new Map<string, any>();
    const teamBStrengths = new Map<string, any>();

    for (const s of strengths || []) {
      const map = s.team_id === teamAId ? teamAStrengths : teamBStrengths;
      map.set(s.position, s);
    }

    // Calculate values for each side
    const allPlayers = [...teamAGives, ...teamBGives];
    const tradePlayerValues: any[] = [];

    for (const playerId of allPlayers) {
      const value = valueMap.get(playerId);
      if (value) {
        tradePlayerValues.push(value);
      }
    }

    // Find best player in trade
    const bestPlayer = tradePlayerValues.reduce((best, p) => 
      p.value_score > (best?.value_score || 0) ? p : best, null
    );

    const bestPlayerBonus = bestPlayer ? bestPlayer.value_score * 0.03 : 0; // 3% bonus
    const bestPlayerReceivedBy = teamBGives.includes(bestPlayer?.player_id) ? teamAId : teamBId;

    // Calculate sums
    let sumAOut = 0, sumAIn = 0, sumBOut = 0, sumBIn = 0;

    for (const playerId of teamAGives) {
      const value = valueMap.get(playerId);
      if (value) sumAOut += value.value_score;
    }

    for (const playerId of teamBGives) {
      const value = valueMap.get(playerId);
      if (value) {
        sumAIn += value.value_score;
        sumBOut += value.value_score;
      }
    }

    for (const playerId of teamAGives) {
      const value = valueMap.get(playerId);
      if (value) sumBIn += value.value_score;
    }

    // Apply best player bonus
    if (bestPlayerReceivedBy === teamAId) {
      sumAIn += bestPlayerBonus;
    } else {
      sumBIn += bestPlayerBonus;
    }

    // Enhanced Positional fit adjustments based on z_score and rank
    const positionalFitNotes: string[] = [];
    const rankChanges: any[] = [];
    let teamAFitBonus = 0;
    let teamBFitBonus = 0;

    // Helper to calculate positional fit bonus based on weakness severity AND rank improvement
    const getPositionalFitBonus = (posStrength: any, playerValue: number, isReceiving: boolean): number => {
      if (!posStrength) return 0;
      
      const zScore = posStrength.z_score;
      const rank = posStrength.rank;
      
      // Base bonus by position weakness
      let baseBonus = 0;
      if (zScore < -1.5) baseBonus = playerValue * 0.08; // Very weak: 8%
      else if (zScore < -1.0) baseBonus = playerValue * 0.05; // Weak: 5%
      else if (zScore < -0.5) baseBonus = playerValue * 0.03; // Below average: 3%
      else if (zScore < 0) baseBonus = playerValue * 0.015; // Slightly below: 1.5%
      
      // Additional bonus for improving bottom 4 positions
      if (isReceiving && rank >= 7) {
        baseBonus += playerValue * 0.10; // +10% for fixing bottom 4
      }
      
      // Penalty for trading from top 3 positions
      if (!isReceiving && rank <= 3) {
        baseBonus -= playerValue * 0.10; // -10% for weakening top 3
      }
      
      return baseBonus;
    };

    // Helper to calculate z-score movement bonus
    const getZScoreMovementBonus = (currentZ: number, playerValue: number, isAdding: boolean): number => {
      // Each 0.5 increase in z-score at position of need = +5% bonus
      const zMovement = isAdding ? (playerValue * 0.05) : 0;
      if (currentZ < 0 && isAdding) {
        return zMovement * Math.abs(currentZ) * 2; // Scale by how far below average
      }
      return 0;
    };

    // Check if Team A improves weak positions by receiving players
    for (const playerId of teamBGives) {
      const value = valueMap.get(playerId);
      if (value) {
        const posStrength = teamAStrengths.get(value.position);
        if (posStrength) {
          const bonus = getPositionalFitBonus(posStrength, value.value_score, true);
          const zBonus = getZScoreMovementBonus(posStrength.z_score, value.value_score, true);
          teamAFitBonus += bonus + zBonus;
          
          if (bonus > 0 || zBonus > 0) {
            const zScore = posStrength.z_score.toFixed(2);
            rankChanges.push({
              team: 'A',
              position: value.position,
              beforeRank: posStrength.rank,
              beforeZ: posStrength.z_score,
              player: value.player_name,
              action: 'receiving',
            });
            positionalFitNotes.push(
              `Team A improves ${value.position} (rank ${posStrength.rank}, z-score ${zScore}) by adding ${value.player_name}`
            );
          }
        }
      }
    }

    // Check if Team A is trading away from positions
    for (const playerId of teamAGives) {
      const value = valueMap.get(playerId);
      if (value) {
        const posStrength = teamAStrengths.get(value.position);
        if (posStrength) {
          const penalty = getPositionalFitBonus(posStrength, value.value_score, false);
          teamAFitBonus += penalty;
          
          if (posStrength.rank <= 3) {
            rankChanges.push({
              team: 'A',
              position: value.position,
              beforeRank: posStrength.rank,
              beforeZ: posStrength.z_score,
              player: value.player_name,
              action: 'giving',
            });
            positionalFitNotes.push(
              `Team A trades from ${value.position} strength (rank ${posStrength.rank})`
            );
          }
        }
      }
    }

    // Check if Team B improves weak positions by receiving players
    for (const playerId of teamAGives) {
      const value = valueMap.get(playerId);
      if (value) {
        const posStrength = teamBStrengths.get(value.position);
        if (posStrength) {
          const bonus = getPositionalFitBonus(posStrength, value.value_score, true);
          const zBonus = getZScoreMovementBonus(posStrength.z_score, value.value_score, true);
          teamBFitBonus += bonus + zBonus;
          
          if (bonus > 0 || zBonus > 0) {
            const zScore = posStrength.z_score.toFixed(2);
            rankChanges.push({
              team: 'B',
              position: value.position,
              beforeRank: posStrength.rank,
              beforeZ: posStrength.z_score,
              player: value.player_name,
              action: 'receiving',
            });
            positionalFitNotes.push(
              `Team B improves ${value.position} (rank ${posStrength.rank}, z-score ${zScore}) by adding ${value.player_name}`
            );
          }
        }
      }
    }

    // Check if Team B is trading away from positions
    for (const playerId of teamBGives) {
      const value = valueMap.get(playerId);
      if (value) {
        const posStrength = teamBStrengths.get(value.position);
        if (posStrength) {
          const penalty = getPositionalFitBonus(posStrength, value.value_score, false);
          teamBFitBonus += penalty;
          
          if (posStrength.rank <= 3) {
            rankChanges.push({
              team: 'B',
              position: value.position,
              beforeRank: posStrength.rank,
              beforeZ: posStrength.z_score,
              player: value.player_name,
              action: 'giving',
            });
            positionalFitNotes.push(
              `Team B trades from ${value.position} strength (rank ${posStrength.rank})`
            );
          }
        }
      }
    }

    sumAIn += teamAFitBonus;
    sumBIn += teamBFitBonus;

    console.log('Positional fit adjustments:', { teamAFitBonus, teamBFitBonus, notes: positionalFitNotes });

    // Calculate net deltas
    const teamANet = sumAIn - sumAOut;
    const teamBNet = sumBIn - sumBOut;

    // Determine advantage and grade
    const totalValue = sumAOut + sumBOut;
    const advantageTeam = teamANet > teamBNet ? teamAId : teamBId;
    const valueDifference = Math.abs(teamANet - teamBNet);
    const percentDiff = totalValue > 0 ? (valueDifference / totalValue) * 100 : 0;

    let grade = 'C';
    if (percentDiff >= 10) grade = 'A';
    else if (percentDiff >= 6) grade = 'B';
    else if (percentDiff >= 3) grade = 'C+';
    else if (percentDiff <= 3 && percentDiff >= -3) grade = 'C';
    else if (percentDiff <= -3 && percentDiff >= -6) grade = 'D+';
    else grade = 'D';

    // Build explanation
    const explanation = buildExplanation({
      teamANet,
      teamBNet,
      advantageTeam,
      bestPlayer,
      positionalFitNotes,
      percentDiff,
      rankChanges,
    });

    const result = {
      trade_grade: grade,
      advantage_team: advantageTeam,
      value_difference: valueDifference,
      percent_difference: percentDiff,
      best_player_received_by: bestPlayerReceivedBy,
      best_player_bonus: bestPlayerBonus,
      positional_fit_notes: positionalFitNotes,
      rank_changes: rankChanges,
      positional_fit_bonus_a: teamAFitBonus,
      positional_fit_bonus_b: teamBFitBonus,
      explanation,
      audit: {
        teamA_out: sumAOut,
        teamA_in: sumAIn,
        teamA_net: teamANet,
        teamB_out: sumBOut,
        teamB_in: sumBIn,
        teamB_net: teamBNet,
      },
      ros_points_delta: teamANet,
      next_3_weeks_delta: teamANet * 0.3, // Approximate
      confidence: 85,
      verdict: teamANet > 0 ? 'accept' : 'reject',
      summary: explanation,
    };

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
        verdict: result.verdict,
        grade: result.trade_grade,
        confidence: result.confidence,
        ros_points_delta: result.ros_points_delta,
        next_3_weeks_delta: result.next_3_weeks_delta,
        best_player_bonus_applied: bestPlayerBonus > 0,
        summary: result.summary,
      });

    if (saveError) console.error('Error saving evaluation:', saveError);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error evaluating trade:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function buildExplanation(params: any): string {
  const { teamANet, teamBNet, advantageTeam, bestPlayer, positionalFitNotes, percentDiff, rankChanges } = params;
  
  let explanation = '';
  
  if (teamANet > teamBNet) {
    explanation += `Team A gains approximately ${teamANet.toFixed(1)} ROS value points in this trade (${percentDiff.toFixed(1)}% advantage). `;
  } else {
    explanation += `Team B gains approximately ${teamBNet.toFixed(1)} ROS value points in this trade (${percentDiff.toFixed(1)}% advantage). `;
  }

  if (bestPlayer) {
    explanation += `The best player in the trade is ${bestPlayer.player_name} (${bestPlayer.value_score.toFixed(1)} value), going to ${advantageTeam}. `;
  }

  // Add rank improvement context
  const teamARankChanges = rankChanges?.filter((r: any) => r.team === 'A' && r.action === 'receiving') || [];
  const teamBRankChanges = rankChanges?.filter((r: any) => r.team === 'B' && r.action === 'receiving') || [];
  
  if (teamARankChanges.length > 0) {
    const topChange = teamARankChanges[0];
    explanation += `Team A addresses a positional need at ${topChange.position} (currently rank ${topChange.beforeRank}). `;
  }
  
  if (teamBRankChanges.length > 0) {
    const topChange = teamBRankChanges[0];
    explanation += `Team B addresses a positional need at ${topChange.position} (currently rank ${topChange.beforeRank}). `;
  }

  if (positionalFitNotes.length > 0) {
    explanation += positionalFitNotes.slice(0, 2).join('. ') + '. '; // Limit to top 2 notes
  }

  return explanation.trim();
}
