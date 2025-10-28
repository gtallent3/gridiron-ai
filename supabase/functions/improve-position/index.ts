import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

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
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { targetPosition, leagueId, myTeam, allTeams, leagueSettings } = await req.json();
    
    console.log('Improve position:', { targetPosition, myTeamId: myTeam.team_id });

    // Get player values from cache
    const { data: playerValues } = await supabase
      .from('player_value_cache')
      .select('*')
      .eq('league_id', leagueId);

    const valueMap = new Map((playerValues || []).map(v => [v.player_id, v]));

    // Get positional strengths for all teams
    const { data: allStrengths } = await supabase
      .from('team_positional_strengths')
      .select('*')
      .eq('league_id', leagueId);

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
      throw new Error(`No positional strength data found for ${targetPosition}`);
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
      const playerId = player.id || player.player_id;
      const val = valueMap.get(playerId);
      if (!val) return 0;
      return Number(val.value_score) || 0;
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
      const playerId = player.id || player.player_id;
      const playerValue = valueMap.get(playerId);
      return {
        id: playerId,
        player_id: playerId,
        name: player.player_name || player.name || playerValue?.player_name || 'Unknown Player',
        position: normPos(player.position),
        team: player.team || playerValue?.team || 'FA',
        value: getPlayerValue(player),
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
      
      // Only target teams that are strong at this position AND weak where I'm strong
      if (!theirTargetPosStrength || theirTargetPosStrength.z_score < 0.5) continue;

      // Find if they have a weakness where I have strength (complementary needs)
      const myStrongPositions = Array.from(myStrengths?.entries() || [])
        .filter(([pos, strength]) => pos !== targetPosition && strength.z_score > 0 && strength.rank <= 4)
        .map(([pos, strength]) => ({ position: pos, ...strength }))
        .sort((a, b) => b.z_score - a.z_score);

      // Check if opponent is weak in any of my strong positions
      const complementaryNeeds = myStrongPositions.filter(myStrong => {
        const theirPosStrength = theirStrengths.get(myStrong.position);
        return theirPosStrength && (theirPosStrength.z_score < -0.3 || theirPosStrength.rank > 6);
      });

      if (complementaryNeeds.length === 0) continue; // Skip if no mutual benefit

      console.log(`Team ${team.team_id} has surplus at ${targetPosition} AND needs:`, 
        complementaryNeeds.map(c => c.position).join(', '));

      const theirRoster = team.roster || [];
      const theirPosPlayers = theirRoster
        .filter((p: any) => normPos(p.position) === targetPosition)
        .map((p: any) => normalizePlayerForTrade(p))
        .filter((p: any) => p.value > 0) // Only include players with value
        .sort((a: any, b: any) => b.value - a.value);

      if (theirPosPlayers.length < 2) continue; // Need at least 2 to target depth

      // Try to find fair trades - target their 2nd, 3rd, 4th best player at this position
      for (const targetPlayerIdx of [1, 2, 3]) {
        if (targetPlayerIdx >= theirPosPlayers.length) continue;
        
        const targetPlayer = theirPosPlayers[targetPlayerIdx];
        const targetValue = targetPlayer.value;

        if (targetValue === 0) continue;

        // Look for matches from my positions that help THEM (complementary needs)
        for (const needPos of complementaryNeeds) {
          const myPosPlayers = myRoster
            .filter((p: any) => normPos(p.position) === needPos.position)
            .map((p: any) => normalizePlayerForTrade(p))
            .filter((p: any) => p.value > 0)
            .sort((a: any, b: any) => b.value - a.value);

          if (myPosPlayers.length < 2) continue;

          // Try 2nd-4th best players to preserve my top player
          for (let i = 1; i < Math.min(myPosPlayers.length, 4); i++) {
            const myPlayer = myPosPlayers[i];
            const myValue = myPlayer.value;
            const valueDiff = targetValue - myValue;

            // Check if it's a fair trade (within 30% value)
            if (Math.abs(valueDiff) < Math.max(targetValue, myValue) * 0.30) {
              // Calculate PSS changes
              const myNewPSS = calculatePSSAfterTrade(
                myRoster,
                targetPosition,
                [targetPlayer],
                [myPlayer]
              );
              const myPSSDelta = myNewPSS - targetPosStrength.pss;
              
              // Estimate my new rank
              const myNewRank = estimateNewRank(
                targetPosStrength.rank,
                targetPosStrength.pss,
                myNewPSS,
                allTeamsPSSForPosition
              );

              // Calculate their PSS improvement
              const theirPosStrength = theirStrengths.get(needPos.position);
              const theirCurrentPSS = theirPosStrength?.pss || 0;
              const theirNewPSS = calculatePSSAfterTrade(
                team.roster || [],
                needPos.position,
                [myPlayer],
                [targetPlayer]
              );
              const theirPSSDelta = theirNewPSS - theirCurrentPSS;

              // Calculate trade fit score
              const rankImprovement = Math.max(0, targetPosStrength.rank - myNewRank);
              const tradeFitScore = 
                (myPSSDelta * 0.6) + 
                (rankImprovement * 10 * 0.3) + 
                ((targetValue - Math.abs(valueDiff)) / targetValue * 0.1);

              // Grade the trade
              let grade = 'C';
              if (rankImprovement >= 3 && myPSSDelta > 15) grade = 'A';
              else if (rankImprovement >= 2 && myPSSDelta > 10) grade = 'B';
              else if (rankImprovement >= 1 && myPSSDelta > 5) grade = 'C+';
              else if (myPSSDelta > 0) grade = 'C';
              else grade = 'D';

              const mutualBenefit = theirPSSDelta > 0 && myPSSDelta > 0;

              console.log(`Match: ${myPlayer.name} → ${targetPlayer.name}, PSS Δ: ${myPSSDelta.toFixed(1)}, Rank: ${targetPosStrength.rank}→${myNewRank}`);
              
              tradeTargets.push({
                myPlayers: [myPlayer],
                theirPlayers: [targetPlayer],
                theirTeam: team,
                valueDiff,
                
                // My metrics
                my_pos_rank_before: targetPosStrength.rank,
                my_pos_rank_after: myNewRank,
                my_pss_before: targetPosStrength.pss,
                my_pss_after: myNewPSS,
                pss_delta: myPSSDelta,
                
                // Their metrics
                opponent_pos_rank_before: theirPosStrength?.rank || 0,
                opponent_pos_rank_after: estimateNewRank(
                  theirPosStrength?.rank || 10,
                  theirCurrentPSS,
                  theirNewPSS,
                  Array.from(strengthsByTeam.values())
                    .map(s => s.get(needPos.position)?.pss || 0)
                    .filter(p => p > 0)
                ),
                opponent_pss_delta: theirPSSDelta,
                opponent_improved_position: needPos.position,
                
                // Scoring
                trade_fit_score: tradeFitScore,
                grade,
                mutual_benefit: mutualBenefit,
                
                // Analysis
                rationale: `Trade ${myPlayer.name} from your strong ${needPos.position} (rank ${needPos.rank}) to get ${targetPlayer.name}. ` +
                  `Your ${targetPosition} improves from rank ${targetPosStrength.rank} → ${myNewRank} (+${myPSSDelta.toFixed(1)} PSS). ` +
                  `Opponent improves their weak ${needPos.position} from rank ${theirPosStrength?.rank || '?'} (${theirPSSDelta > 0 ? `+${theirPSSDelta.toFixed(1)}` : theirPSSDelta.toFixed(1)} PSS). ` +
                  `${mutualBenefit ? '✓ Mutually beneficial' : '⚠️ One-sided favor'}`,
              });
              
              // Limit proposals per team
              if (tradeTargets.filter(t => t.theirTeam.team_id === team.team_id).length >= 2) break;
            }
          }
          if (tradeTargets.filter(t => t.theirTeam.team_id === team.team_id).length >= 2) break;
        }
        if (tradeTargets.filter(t => t.theirTeam.team_id === team.team_id).length >= 2) break;
      }
    }

    console.log(`Found ${tradeTargets.length} total trade proposals`);

    // Sort by trade fit score (best strategic + rank improvement + value)
    tradeTargets.sort((a, b) => {
      // Prioritize mutual benefit
      if (a.mutual_benefit && !b.mutual_benefit) return -1;
      if (!a.mutual_benefit && b.mutual_benefit) return 1;
      
      // Then by trade fit score
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
