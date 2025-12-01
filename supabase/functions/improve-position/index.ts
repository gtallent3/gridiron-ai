import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const POSITION_WEIGHTS = {
  QB: 0.8, RB: 1.2, WR: 1.0, TE: 1.1, K: 0.6, DEF: 0.7,
};

// Bench depth to consider in strength calculations
const BENCH_DEPTH: Record<string, number> = {
  RB: 2,
  WR: 2,
  TE: 1,
  QB: 1,
  K: 0,
  DST: 0,
};

// Position-specific weight vectors (diminishing returns)
const SLOT_WEIGHTS: Record<string, number[]> = {
  RB: [1.00, 0.85, 0.55, 0.30],  // Depth matters - multiple starters + bench
  WR: [1.00, 0.85, 0.55, 0.30],  // Depth matters - multiple starters + bench
  QB: [1.25, 0.35],              // Elite starter emphasis, minimal bench value
  TE: [1.15, 0.35],              // Elite starter emphasis, minimal bench value
  K: [0.60],                     // Low impact
  DST: [0.60],                   // Low impact
};

const DEFAULT_STARTERS: Record<string, number> = { 
  QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authentication is handled by Supabase (verify_jwt = true in config)
    // User is already authenticated if this code executes
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { targetPosition, leagueId, myTeam, allTeams, leagueSettings } = await req.json();
    
    console.log('Improve position:', { targetPosition, myTeamId: myTeam.team_id });

    // Get player rankings data
    const { data: playerRankings, error: rankingsError } = await supabase
      .from('player_rankings')
      .select('player_id, player_name, position, team, trade_value, avg_projected_ppg_ros');

    if (rankingsError) {
      console.error('Rankings load error:', rankingsError);
    }

    console.log(`Loaded ${playerRankings?.length || 0} player rankings`);

    const valueMap = new Map((playerRankings || []).map(v => [v.player_id, v]));

    // Get canonical players mapping for roster lookups
    const { data: canonicalPlayers, error: canonicalError } = await supabase
      .from('canonical_players')
      .select('id, espn_id, yahoo_id, sleeper_id, player_name, position');

    if (canonicalError) {
      console.error('Canonical players load error:', canonicalError);
    }

    const canonicalMap = new Map<string, string>(); // platform_id -> canonical_player_id
    (canonicalPlayers || []).forEach(cp => {
      if (cp.espn_id) canonicalMap.set(`espn_${cp.espn_id}`, cp.id);
      if (cp.yahoo_id) canonicalMap.set(`yahoo_${cp.yahoo_id}`, cp.id);
      if (cp.sleeper_id) canonicalMap.set(`sleeper_${cp.sleeper_id}`, cp.id);
    });

    // Get positional strengths for all teams
    let { data: allStrengths } = await supabase
      .from('team_positional_strengths')
      .select('*')
      .eq('league_id', leagueId);

    // If no positional strengths exist, compute them automatically
    if (!allStrengths || allStrengths.length === 0) {
      console.log('No positional strengths found, computing automatically...');
      
      const { error: computeError } = await supabase.functions.invoke('post-sync-compute', {
        body: { leagueId }
      });

      if (computeError) {
        console.error('Failed to compute positional strengths:', computeError);
        throw new Error('Failed to compute positional strengths. Please try again.');
      }

      // Fetch the newly computed strengths
      const { data: newStrengths } = await supabase
        .from('team_positional_strengths')
        .select('*')
        .eq('league_id', leagueId);

      allStrengths = newStrengths;
    }

    const strengthsByTeam = new Map<string, Map<string, any>>();
    for (const s of allStrengths || []) {
      if (!strengthsByTeam.has(s.team_id)) {
        strengthsByTeam.set(s.team_id, new Map());
      }
      strengthsByTeam.get(s.team_id)!.set(s.position, s);
    }

    const myStrengths = strengthsByTeam.get(myTeam.team_id);
    const targetPosStrength = myStrengths?.get(targetPosition);

    if (!targetPosStrength) {
      throw new Error(`Failed to compute positional strength data for ${targetPosition}. Please ensure your league data is synced correctly.`);
    }

    // Get all PSS values for this position across league for rank estimation
    const allTeamsPSSForPosition = Array.from(strengthsByTeam.values())
      .map(s => s.get(targetPosition)?.pss || 0)
      .filter(p => p > 0);

    console.log(`Target ${targetPosition} strength:`, {
      pss: targetPosStrength.pss,
      rank: targetPosStrength.rank,
      z_score: targetPosStrength.z_score,
      delta_vs_median: targetPosStrength.delta_vs_median,
    });

    const normPos = (pos: any): string => {
      if (typeof pos === 'number') {
        const map: Record<number, string> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };
        return map[pos] || String(pos).toUpperCase();
      }
      const s = String(pos || '').trim().toUpperCase();
      if (/^\d+$/.test(s)) {
        const n = Number(s);
        const map: Record<number, string> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };
        return map[n] || s;
      }
      if (s === 'D/ST' || s === 'DST' || s === 'DEF') return 'DST';
      return ['QB', 'RB', 'WR', 'TE', 'K', 'DST'].includes(s) ? s : s;
    };

    const getPlayerValue = (player: any) => {
      // Try to get canonical_player_id from player or lookup via platform ID
      let canonicalId = player.canonical_player_id;
      
      if (!canonicalId && player.player_id) {
        canonicalId = canonicalMap.get(player.player_id);
      }
      
      if (!canonicalId) return 0;
      
      const val = valueMap.get(canonicalId);
      if (!val) return 0;
      return Number(val.trade_value) || 0;
    };

    // Helper to calculate what PSS would be after adding/removing a player
    const calculatePSSAfterTrade = (
      roster: any[],
      position: string,
      playersAdded: any[],
      playersRemoved: any[]
    ): number => {
      // Get current position players
      const posPlayers = roster
        .filter((p: any) => normPos(p.position) === position)
        .map((p: any) => getPlayerValue(p));
      
      // Remove traded away players
      const removedValues = playersRemoved.map(p => getPlayerValue(p));
      let updatedValues = posPlayers.filter(v => !removedValues.includes(v));
      
      // Add received players
      const addedValues = playersAdded.map(p => getPlayerValue(p));
      updatedValues = [...updatedValues, ...addedValues];
      
      // Calculate new PSS using slot-weighted diminishing returns
      const weights = SLOT_WEIGHTS[position] || [1.0];
      const starters = DEFAULT_STARTERS[position] || 1;
      const bench = BENCH_DEPTH[position] || 0;
      const totalSlots = starters + bench;
      
      const sortedValues = updatedValues.sort((a, b) => b - a);
      const take = Math.min(sortedValues.length, totalSlots, weights.length);
      
      let pss = 0;
      for (let i = 0; i < take; i++) {
        pss += sortedValues[i] * weights[i];
      }
      return pss;
    };

    // Helper to estimate new rank based on PSS change
    const estimateNewRank = (
      currentRank: number,
      currentPSS: number,
      newPSS: number,
      allTeamsPSS: number[]
    ): number => {
      // Sort all PSS values
      const sortedPSS = [...allTeamsPSS, newPSS].sort((a, b) => b - a);
      return sortedPSS.indexOf(newPSS) + 1;
    };

    const normalizePlayerForTrade = (player: any) => {
      // Try to get canonical_player_id from player or lookup via platform ID
      let canonicalId = player.canonical_player_id;
      
      if (!canonicalId && player.player_id) {
        canonicalId = canonicalMap.get(player.player_id);
      }
      
      const playerRanking = canonicalId ? valueMap.get(canonicalId) : null;
      const value = getPlayerValue(player);
      
      return {
        id: canonicalId || player.player_id,
        player_id: player.player_id || canonicalId,
        canonical_player_id: canonicalId,
        name: player.player_name || player.name || playerRanking?.player_name || 'Unknown Player',
        position: normPos(player.position),
        team: player.team || playerRanking?.team || 'FA',
        value,
        trade_value: playerRanking?.trade_value || 0,
        projected_ppg: playerRanking?.avg_projected_ppg_ros || 0,
      };
    };

    // Find teams with surplus at target position (strong positional ranking)
    const tradeTargets: any[] = [];
    const myRoster = myTeam.roster || [];

    for (const team of allTeams) {
      if (team.team_id === myTeam.team_id) continue;

      const theirStrengths = strengthsByTeam.get(team.team_id);
      if (!theirStrengths) continue;

      const theirTargetPosStrength = theirStrengths.get(targetPosition);
      
      // Target teams that have reasonable depth at this position - be lenient
      if (!theirTargetPosStrength || theirTargetPosStrength.rank > 12) continue;

      // PRIORITY 1: Same-position trades (WR for WR, RB for RB)
      // These are always preferred because they don't deplete other positions
      const samePositionTrades: any[] = [];
      
      // PRIORITY 2: Cross-position trades (only when it makes sense for both sides)
      // Find positions where I have tradeable depth
      const myTradablePositions = Array.from(myStrengths?.entries() || [])
        .filter(([pos, strength]) => pos !== targetPosition && strength.rank <= 7)
        .map(([pos, strength]) => ({ position: pos, ...strength }))
        .sort((a, b) => a.rank - b.rank); // Prioritize stronger positions

      // Check if opponent actually NEEDS what I'm offering
      // They should be weak at my strong position AND I should be weak at target position
      const intelligentCrossPositionNeeds = myTradablePositions.filter(myStrong => {
        const theirPosStrength = theirStrengths.get(myStrong.position);
        // They're weak at my position (rank > 5) AND they're strong at target position
        return theirPosStrength && theirPosStrength.rank > 5 && theirTargetPosStrength.rank <= 5;
      });

      // Count how many starters each team needs at each position
      const getStarterCount = (pos: string) => DEFAULT_STARTERS[pos] || 1;
      
      // Filter out positions where opponent doesn't need more depth
      const validCrossPositionTrades = intelligentCrossPositionNeeds.filter(myStrong => {
        const theirPosStrength = theirStrengths.get(myStrong.position);
        const startersNeeded = getStarterCount(myStrong.position);
        
        // For QB/TE (1 starter): only trade if they're truly weak (rank > 7)
        if (startersNeeded === 1 && theirPosStrength && theirPosStrength.rank <= 7) {
          return false; // They don't need depth here
        }
        
        return true;
      });

      // Prioritize same-position trades, then valid cross-position trades
      const tradablePositions = [targetPosition, ...validCrossPositionTrades.map(c => c.position)];

      console.log(`Team ${team.team_id} rank ${theirTargetPosStrength.rank} at ${targetPosition}`);
      console.log(`  Valid trade positions: ${tradablePositions.join(', ')}`);
      console.log(`  Same-position trade available: ${tradablePositions.includes(targetPosition)}`);

      if (tradablePositions.length === 0) continue;

      const theirRoster = team.roster || [];
      const theirPosPlayers = theirRoster
        .filter((p: any) => normPos(p.position) === targetPosition)
        .map((p: any) => normalizePlayerForTrade(p))
        .filter((p: any) => p.value > 0) // Only include players with value
        .sort((a: any, b: any) => b.value - a.value);

      console.log(`Team ${team.team_id} has ${theirPosPlayers.length} ${targetPosition} players with value`);

      if (theirPosPlayers.length < 1) continue; // Need at least 1 player to trade

      // Try to find fair trades - target their best 4 players at this position
      for (const targetPlayerIdx of [0, 1, 2, 3]) {
        if (targetPlayerIdx >= theirPosPlayers.length) continue;
        
        const targetPlayer = theirPosPlayers[targetPlayerIdx];
        const targetValue = targetPlayer.value;

        if (targetValue === 0) continue;

        // Look for matches from my tradable positions
        for (const tradePos of tradablePositions) {
          const isSamePosition = tradePos === targetPosition;
          
          // Extract position from object if needed
          const needPos = typeof tradePos === 'string' ? tradePos : tradePos.position;
          
          const myPosPlayers = myRoster
            .filter((p: any) => normPos(p.position) === needPos)
            .map((p: any) => normalizePlayerForTrade(p))
            .filter((p: any) => p.value > 0)
            .sort((a: any, b: any) => b.value - a.value);

          console.log(`My team has ${myPosPlayers.length} ${needPos} players with value`);

          if (myPosPlayers.length < 1) continue;

          // Try 1-for-1 trades first (tight tolerance)
          for (let i = 0; i < Math.min(myPosPlayers.length, 5); i++) {
            const myPlayer = myPosPlayers[i];
            const myValue = myPlayer.value;
            const valueDiff = targetValue - myValue;

            // 1-for-1: Check if values are close (within 35% value for more options)
            if (Math.abs(valueDiff) < Math.max(targetValue, myValue) * 0.35) {
              // Calculate PSS changes at TARGET position (what I'm improving)
              const myNewTargetPSS = calculatePSSAfterTrade(
                myRoster,
                targetPosition,
                [targetPlayer],
                [myPlayer]
              );
              const myTargetPSSDelta = myNewTargetPSS - targetPosStrength.pss;
              
              // Calculate PSS changes at TRADED position (what I'm losing depth at)
              const myTradedPosStrength = myStrengths?.get(needPos);
              const myTradedPosCurrentPSS = myTradedPosStrength?.pss || 0;
              const myNewTradedPosPSS = calculatePSSAfterTrade(
                myRoster,
                needPos,
                [], // Not adding anyone to this position
                [myPlayer] // Only removing my player
              );
              const myTradedPosPSSDelta = myNewTradedPosPSS - myTradedPosCurrentPSS;
              
              // Calculate NET PSS change across both positions
              const netPSSChange = myTargetPSSDelta + myTradedPosPSSDelta;
              
              // Estimate my new rank at target position
              const myNewRank = estimateNewRank(
                targetPosStrength.rank,
                targetPosStrength.pss,
                myNewTargetPSS,
                allTeamsPSSForPosition
              );

              // Calculate their PSS improvement at the position they're RECEIVING
              const theirReceivingPosStrength = theirStrengths.get(needPos);
              const theirReceivingCurrentPSS = theirReceivingPosStrength?.pss || 0;
              const theirReceivingNewPSS = calculatePSSAfterTrade(
                team.roster || [],
                needPos,
                [myPlayer],  // They receive myPlayer at needPos
                []  // Not removing anyone from needPos
              );
              const theirReceivingPSSDelta = theirReceivingNewPSS - theirReceivingCurrentPSS;
              
              // Calculate their PSS loss at the position they're GIVING UP
              const theirGivingPosStrength = theirStrengths.get(targetPosition);
              const theirGivingCurrentPSS = theirGivingPosStrength?.pss || 0;
              const theirGivingNewPSS = calculatePSSAfterTrade(
                team.roster || [],
                targetPosition,
                [],  // Not adding anyone to targetPosition
                [targetPlayer]  // They lose targetPlayer from targetPosition
              );
              const theirGivingPSSDelta = theirGivingNewPSS - theirGivingCurrentPSS;
              
              // Their NET PSS change across both positions
              const theirNetPSSDelta = theirReceivingPSSDelta + theirGivingPSSDelta;

              // PRIMARY: Net value gain (must be positive)
              const netValueGain = targetValue - myValue;
              
              // SAME-POSITION BONUS: Heavily favor same-position trades
              const samePositionBonus = isSamePosition ? 30 : 0; // Big boost for WR-for-WR, RB-for-RB
              
              // CROSS-POSITION PENALTY: Penalize illogical trades
              let crossPositionPenalty = 0;
              if (!isSamePosition) {
                // Heavy penalty if they don't actually need what I'm offering
                const startersNeeded = getStarterCount(needPos);
                if (startersNeeded === 1 && theirReceivingPosStrength && theirReceivingPosStrength.rank <= 6) {
                  crossPositionPenalty = -50; // They don't need depth at my position
                }
                
                // Penalty for depleting critical positions (RB/WR)
                if ((needPos === 'RB' || needPos === 'WR') && myPosPlayers.length <= 3) {
                  crossPositionPenalty -= 20; // Don't deplete my RB/WR depth
                }
              }
              
              // Be more lenient - allow even trades or slight losses if positional improvement is good
              if (netValueGain < -5 || netPSSChange < -25 || crossPositionPenalty < -40) continue;

              // SECONDARY: Positional improvement boost (contextual modifier)
              const rankImprovement = Math.max(0, targetPosStrength.rank - myNewRank);
              const myPosBoost = (myNewRank < targetPosStrength.rank) ? rankImprovement * 5 : 0;
              
              // Calculate opponent's positional impact at BOTH positions
              // First, their gain at needPos (position they receive)
              const theirReceivingRankChange = (theirReceivingPosStrength?.rank || 10) - estimateNewRank(
                theirReceivingPosStrength?.rank || 10,
                theirReceivingCurrentPSS,
                theirReceivingNewPSS,
                Array.from(strengthsByTeam.values())
                  .map(s => s.get(needPos)?.pss || 0)
                  .filter(p => p > 0)
              );
              
              // Second, their loss at targetPosition (position they give up)
              const theirGivingRankChange = estimateNewRank(
                theirGivingPosStrength?.rank || 10,
                theirGivingCurrentPSS,
                theirGivingNewPSS,
                Array.from(strengthsByTeam.values())
                  .map(s => s.get(targetPosition)?.pss || 0)
                  .filter(p => p > 0)
              ) - (theirGivingPosStrength?.rank || 10);
              
              const theirNetRankChange = theirReceivingRankChange - theirGivingRankChange;
              const theirPosCost = theirNetRankChange > 0 ? theirNetRankChange * 3 : 0;
              const posBoost = myPosBoost - theirPosCost;

              // NEW TRADE SCORE: Net PSS change + value gain + positional context + same-position bonus - cross-position penalty
              const tradeFitScore = (0.8 * netPSSChange) + (1.0 * netValueGain) + (0.25 * posBoost) + samePositionBonus + crossPositionPenalty;

              // Grade based purely on YOUR net value gain (what you receive vs what you give)
              // This is YOUR grade, not a fairness grade
              let grade = 'D';
              if (netValueGain >= 25) grade = 'A+';
              else if (netValueGain >= 20) grade = 'A';
              else if (netValueGain >= 15) grade = 'A-';
              else if (netValueGain >= 10) grade = 'B+';
              else if (netValueGain >= 7) grade = 'B';
              else if (netValueGain >= 5) grade = 'B-';
              else if (netValueGain >= 3) grade = 'C+';
              else if (netValueGain >= 1) grade = 'C';
              else if (netValueGain > 0) grade = 'C-';
              else grade = 'F'; // Should never happen due to earlier filter

              // Acceptance likelihood based on opponent's NET impact across both positions
              let acceptanceLikelihood = 'Medium';
              if (theirNetPSSDelta > 10 && theirNetRankChange >= 2) acceptanceLikelihood = 'High';
              else if (theirNetPSSDelta < 0 || theirNetRankChange >= 4) acceptanceLikelihood = 'Low';
              else acceptanceLikelihood = 'Medium';

              const mutualBenefit = theirNetPSSDelta > 0 && netPSSChange > 0;

              console.log(`Match: ${myPlayer.name} → ${targetPlayer.name}, Net PSS: ${netPSSChange.toFixed(1)}, Value Δ: +${netValueGain.toFixed(1)}, Rank: ${targetPosStrength.rank}→${myNewRank}`);
              
              tradeTargets.push({
                myPlayers: [myPlayer],
                theirPlayers: [targetPlayer],
                theirTeam: team,
                valueDiff,
                
                // PRIMARY METRIC: Net value gain
                net_value_gain: netValueGain,
                net_pss_change: netPSSChange,
                
                // My metrics at TARGET position
                my_pos_rank_before: targetPosStrength.rank,
                my_pos_rank_after: myNewRank,
                my_pss_before: targetPosStrength.pss,
                my_pss_after: myNewTargetPSS,
                pss_delta: myTargetPSSDelta,
                
                // My metrics at TRADED position
                my_traded_pos: needPos,
                my_traded_pos_pss_before: myTradedPosCurrentPSS,
                my_traded_pos_pss_after: myNewTradedPosPSS,
                my_traded_pos_pss_delta: myTradedPosPSSDelta,
                
                // Their metrics
                opponent_pos_rank_before: theirReceivingPosStrength?.rank || 0,
                opponent_pos_rank_after: estimateNewRank(
                  theirReceivingPosStrength?.rank || 10,
                  theirReceivingCurrentPSS,
                  theirReceivingNewPSS,
                  Array.from(strengthsByTeam.values())
                    .map(s => s.get(needPos)?.pss || 0)
                    .filter(p => p > 0)
                ),
                opponent_pss_delta: theirNetPSSDelta,
                opponent_improved_position: needPos,
                opponent_rank_change: theirNetRankChange,
                
                // Scoring
                trade_fit_score: tradeFitScore,
                grade,
                mutual_benefit: mutualBenefit,
                acceptance_likelihood: acceptanceLikelihood,
                
                // Analysis
                rationale: `Net team improvement: ${netPSSChange >= 0 ? '+' : ''}${netPSSChange.toFixed(1)} PSS across both positions. ` +
                  `Net value gain: +${netValueGain.toFixed(1)} ROS points. ` +
                  `Trade ${myPlayer.name} (${myValue.toFixed(1)}) from your ${needPos} (loses ${Math.abs(myTradedPosPSSDelta).toFixed(1)} PSS) to get ${targetPlayer.name} (${targetValue.toFixed(1)}). ` +
                  `Your ${targetPosition} improves from rank ${targetPosStrength.rank} → ${myNewRank} (+${myTargetPSSDelta.toFixed(1)} PSS). ` +
                  `Opponent receives ${myPlayer.name} at ${needPos} (${theirReceivingPSSDelta >= 0 ? '+' : ''}${theirReceivingPSSDelta.toFixed(1)} PSS) and loses ${targetPlayer.name} from ${targetPosition} (${theirGivingPSSDelta >= 0 ? '+' : ''}${theirGivingPSSDelta.toFixed(1)} PSS), net: ${theirNetPSSDelta >= 0 ? '+' : ''}${theirNetPSSDelta.toFixed(1)} PSS. ` +
                  `${isSamePosition ? 'Same-position trade (preferred). ' : 'Cross-position trade. '}` +
                  `Acceptance likelihood: ${acceptanceLikelihood}.`,
              });
              
              // Limit proposals per team
              if (tradeTargets.filter(t => t.theirTeam.team_id === team.team_id).length >= 3) break;
            }
          }

          // Try 2-for-1 trades: I give 2 players for their 1 better player
          if (tradeTargets.filter(t => t.theirTeam.team_id === team.team_id).length < 3) {
            for (let i = 0; i < Math.min(myPosPlayers.length - 1, 4); i++) {
              for (let j = i + 1; j < Math.min(myPosPlayers.length, 5); j++) {
                const myPlayer1 = myPosPlayers[i];
                const myPlayer2 = myPosPlayers[j];
                const myTotalValue = myPlayer1.value + myPlayer2.value;
                const valueDiff = targetValue - myTotalValue;

                // 2-for-1: Check if combined values match (within 35% for more options)
                if (Math.abs(valueDiff) < Math.max(targetValue, myTotalValue) * 0.35) {
                  // Calculate PSS changes at TARGET position
                  const myNewTargetPSS = calculatePSSAfterTrade(
                    myRoster,
                    targetPosition,
                    [targetPlayer],
                    [myPlayer1, myPlayer2]
                  );
                  const myTargetPSSDelta = myNewTargetPSS - targetPosStrength.pss;
                  
                  // Calculate PSS changes at TRADED position (losing 2 players)
                  const myTradedPosStrength = myStrengths?.get(needPos);
                  const myTradedPosCurrentPSS = myTradedPosStrength?.pss || 0;
                  const myNewTradedPosPSS = calculatePSSAfterTrade(
                    myRoster,
                    needPos,
                    [], // Not adding anyone to this position
                    [myPlayer1, myPlayer2] // Only removing my two players
                  );
                  const myTradedPosPSSDelta = myNewTradedPosPSS - myTradedPosCurrentPSS;
                  
                  // Calculate NET PSS change
                  const netPSSChange = myTargetPSSDelta + myTradedPosPSSDelta;
                  
                  const myNewRank = estimateNewRank(
                    targetPosStrength.rank,
                    targetPosStrength.pss,
                    myNewTargetPSS,
                    allTeamsPSSForPosition
                  );

                  // Calculate their PSS improvement at the position they're RECEIVING
                  const theirReceivingPosStrength = theirStrengths.get(needPos);
                  const theirReceivingCurrentPSS = theirReceivingPosStrength?.pss || 0;
                  const theirReceivingNewPSS = calculatePSSAfterTrade(
                    team.roster || [],
                    needPos,
                    [myPlayer1, myPlayer2],  // They receive both players at needPos
                    []  // Not removing anyone from needPos
                  );
                  const theirReceivingPSSDelta = theirReceivingNewPSS - theirReceivingCurrentPSS;
                  
                  // Calculate their PSS loss at the position they're GIVING UP
                  const theirGivingPosStrength = theirStrengths.get(targetPosition);
                  const theirGivingCurrentPSS = theirGivingPosStrength?.pss || 0;
                  const theirGivingNewPSS = calculatePSSAfterTrade(
                    team.roster || [],
                    targetPosition,
                    [],  // Not adding anyone to targetPosition
                    [targetPlayer]  // They lose targetPlayer from targetPosition
                  );
                  const theirGivingPSSDelta = theirGivingNewPSS - theirGivingCurrentPSS;
                  
                  // Their NET PSS change across both positions
                  const theirNetPSSDelta = theirReceivingPSSDelta + theirGivingPSSDelta;

                  const netValueGain = targetValue - myTotalValue;
                  
                  // SAME-POSITION BONUS for 2-for-1
                  const samePositionBonus = isSamePosition ? 30 : 0;
                  
                  // CROSS-POSITION PENALTY for 2-for-1
                  let crossPositionPenalty = 0;
                  if (!isSamePosition) {
                    const startersNeeded = getStarterCount(needPos);
                    if (startersNeeded === 1 && theirReceivingPosStrength && theirReceivingPosStrength.rank <= 6) {
                      crossPositionPenalty = -50; // They don't need 2 more players at this position
                    }
                    
                    // Extra penalty for 2-for-1 depleting RB/WR
                    if ((needPos === 'RB' || needPos === 'WR') && myPosPlayers.length <= 4) {
                      crossPositionPenalty -= 30; // Heavy penalty for depleting key positions
                    }
                  }
                  
                  // Be more lenient on 2-for-1 trades
                  if (netValueGain < -5 || netPSSChange < -30 || crossPositionPenalty < -40) continue;

                  const rankImprovement = Math.max(0, targetPosStrength.rank - myNewRank);
                  const myPosBoost = (myNewRank < targetPosStrength.rank) ? rankImprovement * 5 : 0;
                  
                  // Calculate opponent's positional impact at BOTH positions
                  // First, their gain at needPos (position they receive)
                  const theirReceivingRankChange = (theirReceivingPosStrength?.rank || 10) - estimateNewRank(
                    theirReceivingPosStrength?.rank || 10,
                    theirReceivingCurrentPSS,
                    theirReceivingNewPSS,
                    Array.from(strengthsByTeam.values())
                      .map(s => s.get(needPos)?.pss || 0)
                      .filter(p => p > 0)
                  );
                  
                  // Second, their loss at targetPosition (position they give up)
                  const theirGivingRankChange = estimateNewRank(
                    theirGivingPosStrength?.rank || 10,
                    theirGivingCurrentPSS,
                    theirGivingNewPSS,
                    Array.from(strengthsByTeam.values())
                      .map(s => s.get(targetPosition)?.pss || 0)
                      .filter(p => p > 0)
                  ) - (theirGivingPosStrength?.rank || 10);
                  
                  const theirNetRankChange = theirReceivingRankChange - theirGivingRankChange;
                  const theirPosCost = theirNetRankChange > 0 ? theirNetRankChange * 3 : 0;
                  const posBoost = myPosBoost - theirPosCost;

                  const tradeFitScore = (0.8 * netPSSChange) + (1.0 * netValueGain) + (0.25 * posBoost) + samePositionBonus + crossPositionPenalty;

                  let grade = 'D';
                  if (netValueGain >= 25) grade = 'A+';
                  else if (netValueGain >= 20) grade = 'A';
                  else if (netValueGain >= 15) grade = 'A-';
                  else if (netValueGain >= 10) grade = 'B+';
                  else if (netValueGain >= 7) grade = 'B';
                  else if (netValueGain >= 5) grade = 'B-';
                  else if (netValueGain >= 3) grade = 'C+';
                  else if (netValueGain >= 1) grade = 'C';
                  else if (netValueGain > 0) grade = 'C-';
                  else grade = 'F';

                  // Acceptance likelihood based on opponent's NET impact across both positions
                  let acceptanceLikelihood = 'Medium';
                  if (theirNetPSSDelta > 10 && theirNetRankChange >= 2) acceptanceLikelihood = 'High';
                  else if (theirNetPSSDelta < 0 || theirNetRankChange >= 4) acceptanceLikelihood = 'Low';
                  else acceptanceLikelihood = 'Medium';

                  const mutualBenefit = theirNetPSSDelta > 0 && netPSSChange > 0;

                  console.log(`2-for-1 Match: ${myPlayer1.name} + ${myPlayer2.name} → ${targetPlayer.name}, Net PSS: ${netPSSChange.toFixed(1)}, Value Δ: +${netValueGain.toFixed(1)}`);

                  tradeTargets.push({
                    myPlayers: [myPlayer1, myPlayer2],
                    theirPlayers: [targetPlayer],
                    theirTeam: team,
                    valueDiff,
                    net_value_gain: netValueGain,
                    net_pss_change: netPSSChange,
                    my_pos_rank_before: targetPosStrength.rank,
                    my_pos_rank_after: myNewRank,
                    my_pss_before: targetPosStrength.pss,
                    my_pss_after: myNewTargetPSS,
                    pss_delta: myTargetPSSDelta,
                    my_traded_pos: needPos,
                    my_traded_pos_pss_before: myTradedPosCurrentPSS,
                    my_traded_pos_pss_after: myNewTradedPosPSS,
                    my_traded_pos_pss_delta: myTradedPosPSSDelta,
                    opponent_pos_rank_before: theirReceivingPosStrength?.rank || 0,
                    opponent_pos_rank_after: estimateNewRank(
                      theirReceivingPosStrength?.rank || 10,
                      theirReceivingCurrentPSS,
                      theirReceivingNewPSS,
                      Array.from(strengthsByTeam.values())
                        .map(s => s.get(needPos)?.pss || 0)
                        .filter(p => p > 0)
                    ),
                    opponent_pss_delta: theirNetPSSDelta,
                    opponent_improved_position: needPos,
                    opponent_rank_change: theirNetRankChange,
                    trade_fit_score: tradeFitScore,
                    grade,
                    mutual_benefit: mutualBenefit,
                    acceptance_likelihood: acceptanceLikelihood,
                    rationale: `Net team improvement: ${netPSSChange >= 0 ? '+' : ''}${netPSSChange.toFixed(1)} PSS across both positions. ` +
                      `Net value gain: +${netValueGain.toFixed(1)} ROS points. ` +
                      `Trade 2 players (${myPlayer1.name} + ${myPlayer2.name}, total ${myTotalValue.toFixed(1)}) from your ${needPos} (loses ${Math.abs(myTradedPosPSSDelta).toFixed(1)} PSS) to consolidate into ${targetPlayer.name} (${targetValue.toFixed(1)}). ` +
                      `Your ${targetPosition} improves from rank ${targetPosStrength.rank} → ${myNewRank} (+${myTargetPSSDelta.toFixed(1)} PSS). ` +
                      `${isSamePosition ? 'Same-position trade (preferred). ' : 'Cross-position trade. '}` +
                      `Opponent receives both players at ${needPos} (${theirReceivingPSSDelta >= 0 ? '+' : ''}${theirReceivingPSSDelta.toFixed(1)} PSS) and loses ${targetPlayer.name} from ${targetPosition} (${theirGivingPSSDelta >= 0 ? '+' : ''}${theirGivingPSSDelta.toFixed(1)} PSS), net: ${theirNetPSSDelta >= 0 ? '+' : ''}${theirNetPSSDelta.toFixed(1)} PSS.`,
                  });
                  
                  if (tradeTargets.filter(t => t.theirTeam.team_id === team.team_id).length >= 3) break;
                }
              }
              if (tradeTargets.filter(t => t.theirTeam.team_id === team.team_id).length >= 3) break;
            }
          }

          if (tradeTargets.filter(t => t.theirTeam.team_id === team.team_id).length >= 3) break;
        }
        if (tradeTargets.filter(t => t.theirTeam.team_id === team.team_id).length >= 3) break;
      }
    }

    console.log(`Found ${tradeTargets.length} total trade proposals`);

    // Sort by trade fit score (value-first: net_value_gain dominates)
    tradeTargets.sort((a, b) => {
      // Primary: highest net value gain wins
      return b.trade_fit_score - a.trade_fit_score;
    });

    // Return top proposals
    const finalProposals = tradeTargets.slice(0, 8);

    return new Response(
      JSON.stringify({ 
        targetPosition,
        currentRank: targetPosStrength.rank,
        currentZScore: targetPosStrength.z_score.toFixed(2),
        currentPSS: targetPosStrength.pss.toFixed(1),
        deltaVsMedian: targetPosStrength.delta_vs_median.toFixed(1),
        needsUpgrade: targetPosStrength.z_score < -0.3 || targetPosStrength.rank > 6,
        isVeryWeak: targetPosStrength.z_score < -1.0,
        proposals: finalProposals,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error improving position:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to improve position' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
