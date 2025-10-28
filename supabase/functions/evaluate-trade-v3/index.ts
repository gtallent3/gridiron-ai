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

    // Positional fit adjustments
    const positionalFitNotes: string[] = [];
    let teamAFitBonus = 0;
    let teamBFitBonus = 0;

    // Check if trade improves weak positions
    for (const playerId of teamBGives) {
      const value = valueMap.get(playerId);
      if (value) {
        const posStrength = teamAStrengths.get(value.position);
        if (posStrength && posStrength.z_score < -0.5) {
          teamAFitBonus += value.value_score * 0.02; // 2% bonus
          positionalFitNotes.push(`Team A improves ${value.position} where they rank ${posStrength.rank}`);
        }
      }
    }

    for (const playerId of teamAGives) {
      const value = valueMap.get(playerId);
      if (value) {
        const posStrength = teamBStrengths.get(value.position);
        if (posStrength && posStrength.z_score < -0.5) {
          teamBFitBonus += value.value_score * 0.02;
          positionalFitNotes.push(`Team B improves ${value.position} where they rank ${posStrength.rank}`);
        }
      }
    }

    sumAIn += teamAFitBonus;
    sumBIn += teamBFitBonus;

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
    });

    const result = {
      trade_grade: grade,
      advantage_team: advantageTeam,
      value_difference: valueDifference,
      percent_difference: percentDiff,
      best_player_received_by: bestPlayerReceivedBy,
      best_player_bonus: bestPlayerBonus,
      positional_fit_notes: positionalFitNotes,
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
  const { teamANet, teamBNet, advantageTeam, bestPlayer, positionalFitNotes, percentDiff } = params;
  
  let explanation = '';
  
  if (teamANet > teamBNet) {
    explanation += `Team A gains approximately ${teamANet.toFixed(1)} ROS value points in this trade (${percentDiff.toFixed(1)}% advantage). `;
  } else {
    explanation += `Team B gains approximately ${teamBNet.toFixed(1)} ROS value points in this trade (${percentDiff.toFixed(1)}% advantage). `;
  }

  if (bestPlayer) {
    explanation += `The best player in the trade is ${bestPlayer.player_name} (${bestPlayer.value_score.toFixed(1)} value), going to ${advantageTeam}. `;
  }

  if (positionalFitNotes.length > 0) {
    explanation += positionalFitNotes.join('. ') + '. ';
  }

  return explanation.trim();
}
