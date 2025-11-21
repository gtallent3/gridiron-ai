import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const POSITION_WEIGHTS = {
  QB: 0.8, RB: 1.2, WR: 1.0, TE: 1.1, K: 0.6, DEF: 0.7,
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get JWT from authorization header
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      console.error('No authorization header');
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Create client with service role key for database access (bypasses RLS)
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Create separate client with JWT for auth verification
    const token = authHeader.replace('Bearer ', '');
    const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false }
    });

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !user) {
      console.error('Auth error:', userError?.message || 'No user');
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('User authenticated:', user.id);

    const { mode, leagueId, myTeam, allTeams, targetPlayerId, shopPlayerId, filters } = await req.json();
    
    console.log('Find trades:', { mode, targetPlayerId, shopPlayerId });

    // Get player values from player_rankings (using canonical_player_id)
    const { data: playerRankings } = await supabase
      .from('player_rankings')
      .select('*')
      .eq('season', 2025);

    // Build a map by canonical_player_id
    const rankingsMap = new Map((playerRankings || []).map(r => [r.player_id, r]));
    
    // Helper to get canonical_player_id from roster player
    const getCanonicalId = (player: any): string => {
      return player.canonical_player_id || player.player_id || player.id || '';
    };

    const getPlayerValue = (player: any) => {
      const canonicalId = getCanonicalId(player);
      const ranking = rankingsMap.get(canonicalId);
      return ranking?.trade_value || 0;
    };

    const getPlayerRanking = (player: any) => {
      const canonicalId = getCanonicalId(player);
      return rankingsMap.get(canonicalId);
    };

    // Get positional strengths for my team
    const { data: myStrengths } = await supabase
      .from('team_positional_strengths')
      .select('*')
      .eq('league_id', leagueId)
      .eq('team_id', myTeam.team_id);

    const myStrengthsMap = new Map((myStrengths || []).map(s => [s.position, s]));

    // Identify my weakest positions (highest rank, lowest z_score)
    const weakPositions = (myStrengths || [])
      .filter(s => s.z_score < -0.3 || s.rank > 6)
      .sort((a, b) => a.z_score - b.z_score)
      .map(s => s.position);

    console.log('My weak positions:', weakPositions);

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

    // Calculate positional fit bonus for receiving a player
    const getPositionalFitBonus = (player: any): number => {
      const pos = normPos(player.position);
      const strength = myStrengthsMap.get(pos);
      if (!strength) return 0;
      
      const value = getPlayerValue(player);
      const zScore = strength.z_score;
      const rank = strength.rank;
      
      // Stronger bonus for weaker positions
      let bonus = 0;
      if (zScore < -1.5) bonus = value * 0.15; // Very weak position
      else if (zScore < -1.0) bonus = value * 0.10; // Weak position
      else if (zScore < -0.5) bonus = value * 0.05; // Below average
      
      // Extra bonus for fixing bottom 4 positions
      if (rank >= 7) bonus += value * 0.10;
      
      return bonus;
    };

    // Calculate trade fit score: rank_gain * 0.6 + z_score_gain * 0.3 + value_efficiency * 0.1
    const calculateTradeFitScore = (
      targetPlayer: any,
      givingPlayers: any[],
      position: string,
      posStrength: any
    ): number => {
      if (!posStrength) return 0;
      
      const rankGain = Math.max(0, (10 - posStrength.rank) / 10); // Normalize to 0-1, higher for worse ranks
      const zScoreGain = Math.max(0, -posStrength.z_score); // Higher for negative z-scores
      const targetValue = getPlayerValue(targetPlayer);
      const givingValue = givingPlayers.reduce((sum, p) => sum + getPlayerValue(p), 0);
      const valueEfficiency = givingValue > 0 ? targetValue / givingValue : 0;
      
      return rankGain * 0.6 + zScoreGain * 0.3 + valueEfficiency * 0.1;
    };

    const tradeProposals: any[] = [];

    if (mode === 'target') {
      // Find trades to GET a specific player
      const targetPlayer = allTeams
        .flatMap((t: any) => t.roster || [])
        .find((p: any) => (p.id || p.player_id) === targetPlayerId);

      if (!targetPlayer) {
        throw new Error('Target player not found');
      }

      const targetValue = getPlayerValue(targetPlayer);
      const targetOwner = allTeams.find((t: any) => 
        (t.roster || []).some((p: any) => (p.id || p.player_id) === targetPlayerId)
      );

      // Find fair packages from my roster
      const myRoster = myTeam.roster || [];
      
      // Calculate positional fit for target
      const targetPos = normPos(targetPlayer.position);
      const targetPosStrength = myStrengthsMap.get(targetPos);
      const targetPosBonus = getPositionalFitBonus(targetPlayer);
      const targetIsWeakPos = weakPositions.includes(targetPos);
      
      // 1-for-1 trades
      const oneForOne = myRoster
        .filter((p: any) => {
          const val = getPlayerValue(p);
          return val >= targetValue * 0.85 && val <= targetValue * 1.15;
        })
        .map((p: any) => {
          const myPos = normPos(p.position);
          const myPosStrength = myStrengthsMap.get(myPos);
          const tradingFromStrength = myPosStrength && myPosStrength.z_score > 0.5;
          const fitScore = calculateTradeFitScore(targetPlayer, [p], targetPos, targetPosStrength);
          
          const pRanking = getPlayerRanking(p);
          const targetRanking = getPlayerRanking(targetPlayer);
          
          return {
            myPlayers: [{ ...p, trade_value: pRanking?.trade_value, projected_ppg: pRanking?.avg_projected_ppg_ros }],
            theirPlayers: [{ ...targetPlayer, trade_value: targetRanking?.trade_value, projected_ppg: targetRanking?.avg_projected_ppg_ros }],
            valueDiff: getPlayerValue(p) - targetValue,
            positionalFitBonus: targetPosBonus,
            tradingFromStrength,
            improvesWeakPosition: targetIsWeakPos,
            tradeFitScore: fitScore,
            targetRank: targetPosStrength?.rank,
            targetZScore: targetPosStrength?.z_score,
            type: '1-for-1',
            rationale: targetIsWeakPos 
              ? `Improves your weak ${targetPos} position (rank ${targetPosStrength?.rank}, z-score ${targetPosStrength?.z_score.toFixed(2)})` 
              : `Adds ${targetPlayer.player_name || 'player'} to your roster`,
          };
        });

      // 2-for-1 trades
      const twoForOne: any[] = [];
      for (let i = 0; i < myRoster.length; i++) {
        for (let j = i + 1; j < myRoster.length; j++) {
          const combo = [myRoster[i], myRoster[j]];
          const comboValue = combo.reduce((sum, p) => sum + getPlayerValue(p), 0);
          if (comboValue >= targetValue * 0.85 && comboValue <= targetValue * 1.15) {
            const fitScore = calculateTradeFitScore(targetPlayer, combo, targetPos, targetPosStrength);
            const targetRanking = getPlayerRanking(targetPlayer);
            
            twoForOne.push({
              myPlayers: combo.map(p => {
                const pRanking = getPlayerRanking(p);
                return { ...p, trade_value: pRanking?.trade_value, projected_ppg: pRanking?.avg_projected_ppg_ros };
              }),
              theirPlayers: [{ ...targetPlayer, trade_value: targetRanking?.trade_value, projected_ppg: targetRanking?.avg_projected_ppg_ros }],
              valueDiff: comboValue - targetValue,
              positionalFitBonus: targetPosBonus,
              improvesWeakPosition: targetIsWeakPos,
              tradeFitScore: fitScore,
              targetRank: targetPosStrength?.rank,
              targetZScore: targetPosStrength?.z_score,
              type: '2-for-1',
              rationale: targetIsWeakPos 
                ? `Consolidates depth to improve weak ${targetPos} position (rank ${targetPosStrength?.rank})` 
                : `2-for-1 consolidation trade`,
            });
          }
        }
      }

      // Sort by trade fit score first, then positional fit, then value fairness
      const sortByFit = (a: any, b: any) => {
        // Prioritize by trade fit score
        if (Math.abs((a.tradeFitScore || 0) - (b.tradeFitScore || 0)) > 0.1) {
          return (b.tradeFitScore || 0) - (a.tradeFitScore || 0);
        }
        // Then by weak position improvement
        if (a.improvesWeakPosition && !b.improvesWeakPosition) return -1;
        if (!a.improvesWeakPosition && b.improvesWeakPosition) return 1;
        // Finally by value fairness
        return Math.abs(a.valueDiff) - Math.abs(b.valueDiff);
      };

      tradeProposals.push(
        ...oneForOne.sort(sortByFit).slice(0, 3),
        ...twoForOne.sort(sortByFit).slice(0, 2)
      );

    } else if (mode === 'shop') {
      // Find trades to SHIP a specific player
      const shopPlayer = (myTeam.roster || []).find(
        (p: any) => (p.id || p.player_id) === shopPlayerId
      );

      if (!shopPlayer) {
        throw new Error('Shop player not found');
      }

      const shopValue = getPlayerValue(shopPlayer);
      const shopPos = normPos(shopPlayer.position);

      // Look through all opponent teams
      for (const team of allTeams) {
        if (team.team_id === myTeam.team_id) continue;

        const opponentRoster = team.roster || [];

        // Prioritize getting players in my weak positions
        const matches = opponentRoster
          .filter((p: any) => {
            const val = getPlayerValue(p);
            return val >= shopValue * 0.85 && val <= shopValue * 1.15;
          })
          .map((p: any) => {
            const targetPos = normPos(p.position);
            const targetPosStrength = myStrengthsMap.get(targetPos);
            const posBonus = getPositionalFitBonus(p);
            const improvesWeakPos = weakPositions.includes(targetPos);
            const fitScore = calculateTradeFitScore(p, [shopPlayer], targetPos, targetPosStrength);
            
            const shopRanking = getPlayerRanking(shopPlayer);
            const pRanking = getPlayerRanking(p);
            
            return {
              myPlayers: [{ ...shopPlayer, trade_value: shopRanking?.trade_value, projected_ppg: shopRanking?.avg_projected_ppg_ros }],
              theirPlayers: [{ ...p, trade_value: pRanking?.trade_value, projected_ppg: pRanking?.avg_projected_ppg_ros }],
              theirTeam: team,
              valueDiff: getPlayerValue(p) - shopValue,
              positionalFitBonus: posBonus,
              improvesWeakPosition: improvesWeakPos,
              tradeFitScore: fitScore,
              targetRank: targetPosStrength?.rank,
              targetZScore: targetPosStrength?.z_score,
              type: '1-for-1',
              rationale: improvesWeakPos
                ? `Trade ${shopPlayer.player_name || 'player'} to improve weak ${targetPos} position (rank ${targetPosStrength?.rank})`
                : `1-for-1 swap for ${p.player_name || 'player'}`,
            };
          });

        // Sort matches by trade fit score first
        matches.sort((a: any, b: any) => {
          if (Math.abs((a.tradeFitScore || 0) - (b.tradeFitScore || 0)) > 0.1) {
            return (b.tradeFitScore || 0) - (a.tradeFitScore || 0);
          }
          if (a.improvesWeakPosition && !b.improvesWeakPosition) return -1;
          if (!a.improvesWeakPosition && b.improvesWeakPosition) return 1;
          return Math.abs(a.valueDiff) - Math.abs(b.valueDiff);
        });

        tradeProposals.push(...matches.slice(0, 2));
      }
    }

    // Sort by trade fit score, then positional fit, then value fairness
    tradeProposals.sort((a, b) => {
      // Prioritize by trade fit score
      if (Math.abs((a.tradeFitScore || 0) - (b.tradeFitScore || 0)) > 0.1) {
        return (b.tradeFitScore || 0) - (a.tradeFitScore || 0);
      }
      
      // Then by trades that improve weak positions
      if (a.improvesWeakPosition && !b.improvesWeakPosition) return -1;
      if (!a.improvesWeakPosition && b.improvesWeakPosition) return 1;
      
      // Then by positional fit bonus
      const bonusDiff = (b.positionalFitBonus || 0) - (a.positionalFitBonus || 0);
      if (Math.abs(bonusDiff) > 0.5) return bonusDiff > 0 ? 1 : -1;
      
      // Finally by value fairness
      return Math.abs(a.valueDiff) - Math.abs(b.valueDiff);
    });

    return new Response(
      JSON.stringify({ 
        proposals: tradeProposals.slice(0, 10),
        mode,
        targetPlayerId,
        shopPlayerId 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error finding trades:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to find trades' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
