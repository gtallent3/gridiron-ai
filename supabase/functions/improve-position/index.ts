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
      
      // Only target teams that are strong at this position (z_score > 0.5, rank <= 4)
      if (!theirTargetPosStrength || theirTargetPosStrength.z_score < 0.5) continue;

      console.log(`Team ${team.team_id} has surplus at ${targetPosition}:`, {
        rank: theirTargetPosStrength.rank,
        z_score: theirTargetPosStrength.z_score,
      });

      const theirRoster = team.roster || [];
      const theirPosPlayers = theirRoster
        .filter((p: any) => normPos(p.position) === targetPosition)
        .map((p: any) => normalizePlayerForTrade(p))
        .filter((p: any) => p.value > 0) // Only include players with value
        .sort((a: any, b: any) => b.value - a.value);

      if (theirPosPlayers.length < 2) continue; // Need at least 2 to target depth

      // Find positions where I have strength (z_score > 0) to trade from
      const myStrongPositions = Array.from(myStrengths?.entries() || [])
        .filter(([pos, strength]) => pos !== targetPosition && strength.z_score > 0)
        .map(([pos, strength]) => ({ position: pos, ...strength }))
        .sort((a, b) => b.z_score - a.z_score);

      // Try to find fair trades - target their 2nd, 3rd, 4th best player at this position
      for (const targetPlayerIdx of [1, 2, 3]) {
        if (targetPlayerIdx >= theirPosPlayers.length) continue;
        
        const targetPlayer = theirPosPlayers[targetPlayerIdx];
        const targetValue = targetPlayer.value;

        if (targetValue === 0) continue; // Skip players with no value

        console.log(`Considering ${targetPlayer.name} (value: ${targetValue}) from team ${team.team_id}`);

        // Look for matches from my positions of strength
        for (const myStrongPos of myStrongPositions) {
          const myPosPlayers = myRoster
            .filter((p: any) => normPos(p.position) === myStrongPos.position)
            .map((p: any) => normalizePlayerForTrade(p))
            .filter((p: any) => p.value > 0)
            .sort((a: any, b: any) => b.value - a.value);

          if (myPosPlayers.length < 2) continue; // Need depth to trade

          // Don't trade my best player at this position, try 2nd-4th best
          for (let i = 1; i < Math.min(myPosPlayers.length, 4); i++) {
            const myPlayer = myPosPlayers[i];
            const myValue = myPlayer.value;
            const valueDiff = targetValue - myValue;

            // Check if it's a fair trade (within 30% value)
            if (Math.abs(valueDiff) < targetValue * 0.30) {
              const positionGainEstimate = targetValue * 0.4;
              
              console.log(`Found match: ${myPlayer.name} (${myValue}) for ${targetPlayer.name} (${targetValue})`);
              
              tradeTargets.push({
                myPlayers: [myPlayer],
                theirPlayers: [targetPlayer],
                theirTeam: team,
                valueDiff,
                positionGain: positionGainEstimate,
                myPositionRank: myStrongPos.rank,
                theirPositionRank: theirTargetPosStrength.rank,
                myPositionZScore: myStrongPos.z_score,
                theirPositionZScore: theirTargetPosStrength.z_score,
                rationale: `Trade ${myPlayer.name} from your strong ${myStrongPos.position} (rank ${myStrongPos.rank}, z-score ${myStrongPos.z_score.toFixed(2)}) to get ${targetPlayer.name} and improve weak ${targetPosition} (rank ${targetPosStrength.rank}, z-score ${targetPosStrength.z_score.toFixed(2)}). Opponent is strong at ${targetPosition} (rank ${theirTargetPosStrength.rank}).`,
              });
              
              // Limit to 2 proposals per opponent to avoid spam
              if (tradeTargets.filter(t => t.theirTeam.team_id === team.team_id).length >= 2) break;
            }
          }
          if (tradeTargets.filter(t => t.theirTeam.team_id === team.team_id).length >= 2) break;
        }
        if (tradeTargets.filter(t => t.theirTeam.team_id === team.team_id).length >= 2) break;
      }
    }

    console.log(`Found ${tradeTargets.length} total trade proposals`);

    // Sort by best strategic fit (trading from strength to weakness)
    tradeTargets.sort((a, b) => {
      // Prioritize trades where I'm trading from greater strength
      const aStrengthDiff = a.myPositionZScore - a.theirPositionZScore;
      const bStrengthDiff = b.myPositionZScore - b.theirPositionZScore;
      if (Math.abs(aStrengthDiff - bStrengthDiff) > 0.3) {
        return bStrengthDiff - aStrengthDiff;
      }
      // Then by position gain
      return b.positionGain - a.positionGain;
    });

    // Enrich proposals with rank improvement estimates
    const enrichedProposals = tradeTargets.slice(0, 8).map(t => ({
      ...t,
      estimatedRankImprovement: Math.max(1, Math.floor(t.positionGain / 15)),
      improvementContext: `Would improve ${targetPosition} from rank ${targetPosStrength.rank} (z-score ${targetPosStrength.z_score.toFixed(2)})`,
    }));

    return new Response(
      JSON.stringify({ 
        targetPosition,
        currentRank: targetPosStrength.rank,
        currentZScore: targetPosStrength.z_score.toFixed(2),
        currentPSS: targetPosStrength.pss.toFixed(1),
        deltaVsMedian: targetPosStrength.delta_vs_median.toFixed(1),
        needsUpgrade: targetPosStrength.z_score < -0.3 || targetPosStrength.rank > 6,
        isVeryWeak: targetPosStrength.z_score < -1.0,
        proposals: enrichedProposals,
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
