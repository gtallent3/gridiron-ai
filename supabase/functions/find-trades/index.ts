import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

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

    const { mode, leagueId, myTeam, allTeams, targetPlayerId, shopPlayerId, filters } = await req.json();
    
    console.log('Find trades:', { mode, targetPlayerId, shopPlayerId });

    // Get player values from cache
    const { data: playerValues } = await supabase
      .from('player_value_cache')
      .select('*')
      .eq('league_id', leagueId);

    const valueMap = new Map((playerValues || []).map(v => [v.player_id, v]));

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

    const getPlayerValue = (player: any) => {
      const playerId = player.id || player.player_id || player.player_id;
      const val = valueMap.get(playerId);
      if (!val) return 0;
      return Number(val.value_score) || 0;
    };

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
      
      // Stronger bonus for weaker positions
      if (zScore < -1.5) return value * 0.15; // Very weak position
      if (zScore < -1.0) return value * 0.10; // Weak position
      if (zScore < -0.5) return value * 0.05; // Below average
      return 0;
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
          
          return {
            myPlayers: [p],
            theirPlayers: [targetPlayer],
            valueDiff: getPlayerValue(p) - targetValue,
            positionalFitBonus: targetPosBonus,
            tradingFromStrength,
            improvesWeakPosition: targetIsWeakPos,
            type: '1-for-1',
            rationale: targetIsWeakPos 
              ? `Improves your weak ${targetPos} position (rank ${myStrengthsMap.get(targetPos)?.rank})` 
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
            twoForOne.push({
              myPlayers: combo,
              theirPlayers: [targetPlayer],
              valueDiff: comboValue - targetValue,
              positionalFitBonus: targetPosBonus,
              improvesWeakPosition: targetIsWeakPos,
              type: '2-for-1',
              rationale: targetIsWeakPos 
                ? `Consolidates depth to improve weak ${targetPos} position` 
                : `2-for-1 consolidation trade`,
            });
          }
        }
      }

      // Sort by positional fit first, then value fairness
      const sortByFit = (a: any, b: any) => {
        if (a.improvesWeakPosition && !b.improvesWeakPosition) return -1;
        if (!a.improvesWeakPosition && b.improvesWeakPosition) return 1;
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
            const posBonus = getPositionalFitBonus(p);
            const improvesWeakPos = weakPositions.includes(targetPos);
            
            return {
              myPlayers: [shopPlayer],
              theirPlayers: [p],
              theirTeam: team,
              valueDiff: getPlayerValue(p) - shopValue,
              positionalFitBonus: posBonus,
              improvesWeakPosition: improvesWeakPos,
              type: '1-for-1',
              rationale: improvesWeakPos
                ? `Trade ${shopPlayer.player_name || 'player'} to improve weak ${targetPos} position`
                : `1-for-1 swap for ${p.player_name || 'player'}`,
            };
          });

        // Sort matches by positional fit first
        matches.sort((a: any, b: any) => {
          if (a.improvesWeakPosition && !b.improvesWeakPosition) return -1;
          if (!a.improvesWeakPosition && b.improvesWeakPosition) return 1;
          return Math.abs(a.valueDiff) - Math.abs(b.valueDiff);
        });

        tradeProposals.push(...matches.slice(0, 2));
      }
    }

    // Sort by positional fit first, then value fairness
    tradeProposals.sort((a, b) => {
      // Prioritize trades that improve weak positions
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
