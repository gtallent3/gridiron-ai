import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Positional scarcity weights (configurable)
const POSITION_WEIGHTS = {
  QB: 0.8,
  RB: 1.2,
  WR: 1.0,
  TE: 1.1,
  K: 0.6,
  DEF: 0.7,
};

const BEST_PLAYER_BONUS = 0.07; // 7% bonus
const SCHEDULE_WEIGHT = 0.05; // Max 5% adjustment
const SENTIMENT_WEIGHT = 0.03; // Max 3% adjustment

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader! } },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { 
      leagueId,
      myTeam, 
      theirTeam, 
      scoringType,
      myPlayers,
      theirPlayers 
    } = await req.json();

    console.log('Evaluating trade v2:', {
      myPlayers: myPlayers.length,
      theirPlayers: theirPlayers.length,
      scoringType,
    });

    // Get current week/season
    const now = new Date();
    const currentWeek = Math.min(Math.floor((now.getTime() - new Date(now.getFullYear(), 8, 1).getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1, 18);
    const currentSeason = now.getFullYear();

    // Get all player IDs from both sides and validate format
    const VALID_PLAYER_ID = /^[a-zA-Z0-9_-]+$/;
    const allPlayerIds = [...myPlayers, ...theirPlayers]
      .map(p => p.id || p.player_id)
      .filter(id => id && VALID_PLAYER_ID.test(id) && id.length < 100);

    if (allPlayerIds.length === 0) {
      throw new Error('Invalid player IDs provided');
    }

    // Look up normalized player IDs using proper parameterized queries
    const { data: byPlayerId } = await supabase
      .from('normalized_players')
      .select('player_id, espn_id, sleeper_id')
      .in('player_id', allPlayerIds);

    const { data: byEspnId } = await supabase
      .from('normalized_players')
      .select('player_id, espn_id, sleeper_id')
      .in('espn_id', allPlayerIds);

    const { data: bySleeperId } = await supabase
      .from('normalized_players')
      .select('player_id, espn_id, sleeper_id')
      .in('sleeper_id', allPlayerIds);

    // Combine results and deduplicate
    const normalizedPlayers = [
      ...(byPlayerId || []),
      ...(byEspnId || []),
      ...(bySleeperId || [])
    ];

    // Build mapping from platform ID to normalized player_id
    const playerIdMap = new Map<string, string>();
    if (normalizedPlayers) {
      for (const p of normalizedPlayers) {
        if (p.espn_id) playerIdMap.set(p.espn_id, p.player_id);
        if (p.sleeper_id) playerIdMap.set(p.sleeper_id, p.player_id);
        playerIdMap.set(p.player_id, p.player_id); // Also map normalized ID to itself
      }
    }

    // Convert player IDs to normalized IDs for valuation lookups
    const normalizedPlayerIds = allPlayerIds.map(id => playerIdMap.get(id) || id);

    // Fetch player valuations from database using normalized IDs
    const { data: valuations } = await supabase
      .from('player_valuations')
      .select('*')
      .in('player_id', normalizedPlayerIds)
      .eq('season', currentSeason)
      .eq('week', currentWeek);

    const valuationMap = new Map(
      (valuations || []).map(v => [v.player_id, v])
    );

    // Get team strategy for risk profile
    const { data: teamStrategy } = await supabase
      .from('team_strategies')
      .select('*')
      .eq('league_id', leagueId)
      .eq('team_id', myTeam.team_id)
      .single();

    const riskProfile = teamStrategy?.risk_profile || 'balanced';
    const mustWinMode = teamStrategy?.must_win_mode || false;
    const playoffOdds = teamStrategy?.playoff_odds || 0.5;

    // Calculate player values with context
    const calculatePlayerValue = (player: any) => {
      const platformId = player.id || player.player_id;
      const normalizedId = playerIdMap.get(platformId) || platformId;
      const valuation = valuationMap.get(normalizedId);
      
      if (!valuation) {
        // Fallback to projected points
        return {
          rosValue: (player.projected || 0) * POSITION_WEIGHTS[player.position as keyof typeof POSITION_WEIGHTS] || 1,
          next3Value: (player.projected || 0) * 0.3,
          scheduleAdj: 0,
          sentimentAdj: 0,
          volatility: false,
          is_bye_week: false,
          injury_status: null,
          injury_duration_weeks: 0,
        };
      }

      const posWeight = POSITION_WEIGHTS[valuation.position as keyof typeof POSITION_WEIGHTS] || 1;
      let rosValue = Number(valuation.player_value) * posWeight;
      let next3Value = Number(valuation.next_3_weeks_projection);

      // Bye week and injury handling
      const isByeWeek = valuation.is_bye_week || false;
      const injuryStatus = valuation.injury_status;
      const injuryDuration = valuation.injury_duration_weeks || 0;

      // Bye week: reduce next 3 weeks but NOT ROS value (temporary absence)
      if (isByeWeek) {
        next3Value *= 0.67; // One week of 3 is a bye
        // ROS value is unaffected by bye weeks
      }

      // Injury: reduce both short-term and long-term value based on severity
      if (injuryStatus && (injuryStatus === 'Out' || injuryStatus === 'IR' || injuryStatus === 'PUP' || injuryStatus === 'Doubtful' || injuryStatus === 'Questionable')) {
        if (injuryDuration >= 4 || injuryStatus === 'IR' || injuryStatus === 'PUP') {
          // Long-term injury (4+ weeks or IR): significant ROS penalty
          rosValue *= 0.3; // 70% penalty
          next3Value *= 0.1; // Likely out for next 3 weeks
        } else if (injuryDuration >= 2) {
          // Medium-term (2-3 weeks): moderate penalty
          rosValue *= 0.75; // 25% penalty
          next3Value *= 0.5; // 50% penalty for next 3 weeks
        } else if (injuryDuration === 1 || injuryStatus === 'Out' || injuryStatus === 'Doubtful') {
          // Short-term (1 week): minor penalty
          rosValue *= 0.9; // 10% penalty
          next3Value *= 0.7; // 30% penalty for next 3 weeks
        } else if (injuryStatus === 'Questionable') {
          // Questionable: very minor penalty
          rosValue *= 0.95; // 5% penalty
          next3Value *= 0.85; // 15% penalty
        }
      }

      // Apply schedule adjustment
      const scheduleAdj = Number(valuation.schedule_difficulty) * SCHEDULE_WEIGHT;
      rosValue *= (1 - scheduleAdj);

      // Apply sentiment adjustment
      const sentimentAdj = Number(valuation.sentiment_score) * SENTIMENT_WEIGHT;
      rosValue *= (1 + sentimentAdj);

      // Risk profile adjustments
      if (riskProfile === 'aggressive' || playoffOdds >= 0.9) {
        // Weight ROS more heavily
        rosValue *= 1.1;
        next3Value *= 0.9;
      } else if (mustWinMode || playoffOdds < 0.5) {
        // Weight next 3 weeks more heavily
        rosValue *= 0.9;
        next3Value *= 1.2;
      }

      return {
        rosValue,
        next3Value,
        scheduleAdj,
        sentimentAdj,
        volatility: valuation.volatility_flag,
        usageTrend: Number(valuation.usage_trend),
        roleStability: Number(valuation.role_stability),
        is_bye_week: isByeWeek,
        injury_status: injuryStatus,
        injury_duration_weeks: injuryDuration,
      };
    };

    // Calculate values for each side
    const myPlayerValues = myPlayers.map((p: any) => ({
      ...p,
      ...calculatePlayerValue(p),
    }));

    const theirPlayerValues = theirPlayers.map((p: any) => ({
      ...p,
      ...calculatePlayerValue(p),
    }));

    const myTotalROS = myPlayerValues.reduce((sum: number, p: any) => sum + p.rosValue, 0);
    const theirTotalROS = theirPlayerValues.reduce((sum: number, p: any) => sum + p.rosValue, 0);
    const myTotalNext3 = myPlayerValues.reduce((sum: number, p: any) => sum + p.next3Value, 0);
    const theirTotalNext3 = theirPlayerValues.reduce((sum: number, p: any) => sum + p.next3Value, 0);

    // Find best player
    const allPlayers = [...myPlayerValues, ...theirPlayerValues];
    const bestPlayer = allPlayers.reduce((max: any, p: any) => p.rosValue > max.rosValue ? p : max, allPlayers[0]);
    const bestPlayerOnMySide = myPlayerValues.some((p: any) => p.id === bestPlayer.id || p.player_id === bestPlayer.id);

    // Apply Best Player Bonus
    let rosDelta = theirTotalROS - myTotalROS;
    let next3Delta = theirTotalNext3 - myTotalNext3;
    let bestPlayerBonusApplied = false;

    if (bestPlayer) {
      const bonusValue = bestPlayer.rosValue * BEST_PLAYER_BONUS;
      if (bestPlayerOnMySide) {
        rosDelta -= bonusValue; // I'm losing best player, so worse for me
      } else {
        rosDelta += bonusValue; // I'm gaining best player, better for me
        bestPlayerBonusApplied = true;
      }
    }

    // Calculate grade
    let grade: string;
    let verdict: string;
    
    if (rosDelta >= 35) {
      grade = 'A';
      verdict = 'accept';
    } else if (rosDelta >= 15) {
      grade = 'B';
      verdict = 'accept';
    } else if (rosDelta >= -5) {
      grade = 'C';
      verdict = 'close';
    } else if (rosDelta >= -20) {
      grade = 'D';
      verdict = 'decline';
    } else {
      grade = 'F';
      verdict = 'decline';
    }

    // Build explanation factors
    const keyFactors: string[] = [];
    
    if (bestPlayerBonusApplied) {
      keyFactors.push(`You acquire the best player in the trade (${bestPlayer.name}, +${(bestPlayer.rosValue * BEST_PLAYER_BONUS).toFixed(1)} bonus pts)`);
    } else if (bestPlayerOnMySide) {
      keyFactors.push(`You trade away the best player (${bestPlayer.name}, -${(bestPlayer.rosValue * BEST_PLAYER_BONUS).toFixed(1)} penalty)`);
    }

    if (Math.abs(rosDelta) > 20) {
      keyFactors.push(`${rosDelta > 0 ? 'Significant' : 'Major'} value ${rosDelta > 0 ? 'gain' : 'loss'} of ${Math.abs(rosDelta).toFixed(1)} ROS points`);
    }

    if (mustWinMode) {
      keyFactors.push(`Must-win mode: Next 3 weeks ${next3Delta >= 0 ? 'gain' : 'loss'} of ${Math.abs(next3Delta).toFixed(1)} pts is critical`);
    }

    // Position analysis
    const myPositions: Record<string, number> = {};
    const theirPositions: Record<string, number> = {};
    
    myPlayerValues.forEach((p: any) => {
      myPositions[p.position] = (myPositions[p.position] || 0) + p.rosValue;
    });
    
    theirPlayerValues.forEach((p: any) => {
      theirPositions[p.position] = (theirPositions[p.position] || 0) + p.rosValue;
    });

    const positionalImpacts = Object.keys({ ...myPositions, ...theirPositions }).map(pos => {
      const losing = myPositions[pos] || 0;
      const gaining = theirPositions[pos] || 0;
      const netChange = gaining - losing;
      
      let impact = 'No change';
      if (netChange > 10) impact = `Significant upgrade (+${netChange.toFixed(1)} pts)`;
      else if (netChange > 0) impact = `Slight improvement (+${netChange.toFixed(1)} pts)`;
      else if (netChange < -10) impact = `Significant downgrade (${netChange.toFixed(1)} pts)`;
      else if (netChange < 0) impact = `Slight decline (${netChange.toFixed(1)} pts)`;
      
      return { position: pos, impact, delta: netChange };
    });

    // Add volatility warnings
    const volatilePlayers = [...myPlayerValues, ...theirPlayerValues].filter(p => p.volatility);
    if (volatilePlayers.length > 0) {
      keyFactors.push(`⚠️ Volatile players involved: ${volatilePlayers.map(p => p.name).join(', ')}`);
    }

    // Calculate confidence
    let confidence = 75;
    if (Math.abs(rosDelta) > 30) confidence += 15;
    else if (Math.abs(rosDelta) < 10) confidence -= 15;
    if (volatilePlayers.length > 0) confidence -= 10;
    confidence = Math.max(0, Math.min(100, confidence));

    const summary = `This trade ${verdict === 'accept' ? 'improves' : verdict === 'close' ? 'is balanced for' : 'weakens'} your team by ${rosDelta >= 0 ? '+' : ''}${rosDelta.toFixed(1)} rest-of-season points${bestPlayerBonusApplied ? ' (including Best Player Bonus)' : ''}.`;

    const result = {
      grade,
      verdict,
      confidence,
      ros_points_delta: rosDelta,
      next_3_weeks_delta: next3Delta,
      best_player_bonus_applied: bestPlayerBonusApplied,
      summary,
      key_factors: keyFactors,
      positional_impacts: positionalImpacts,
      risk_profile: riskProfile,
      must_win_mode: mustWinMode,
    };

    // Save evaluation
    await supabase.from('trade_evaluations').insert({
      league_id: leagueId,
      user_id: user.id,
      my_team_id: myTeam.team_id,
      their_team_id: theirTeam.team_id,
      my_players: myPlayers,
      their_players: theirPlayers,
      grade,
      verdict,
      confidence,
      ros_points_delta: rosDelta,
      next_3_weeks_delta: next3Delta,
      best_player_bonus_applied: bestPlayerBonusApplied,
      summary,
      key_factors: keyFactors,
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error evaluating trade:', error);
    return new Response(
      JSON.stringify({ error: 'Unable to evaluate trade' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
