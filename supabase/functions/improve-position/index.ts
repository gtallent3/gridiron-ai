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
      const playerId = player.id || player.player_id || player.player_id;
      const val = valueMap.get(playerId);
      if (!val) return 0;
      return Number(val.value_score) || 0;
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
        .map((p: any) => ({ ...p, value: getPlayerValue(p) }))
        .sort((a: any, b: any) => b.value - a.value);

      if (theirPosPlayers.length < 3) continue;

      // Find positions where I have strength (z_score > 0) to trade from
      const myStrongPositions = Array.from(myStrengths?.entries() || [])
        .filter(([pos, strength]) => pos !== targetPosition && strength.z_score > 0)
        .map(([pos, strength]) => ({ position: pos, ...strength }))
        .sort((a, b) => b.z_score - a.z_score);

      // Try to find fair trades - target their 3rd, 4th, 5th best player
      for (const targetPlayerIdx of [2, 3, 4]) {
        if (targetPlayerIdx >= theirPosPlayers.length) continue;
        
        const targetPlayer = theirPosPlayers[targetPlayerIdx];
        const targetValue = targetPlayer.value;

        // Look for matches from my positions of strength
        for (const myStrongPos of myStrongPositions) {
          const myPosPlayers = myRoster
            .filter((p: any) => normPos(p.position) === myStrongPos.position)
            .map((p: any) => ({ ...p, value: getPlayerValue(p) }))
            .sort((a: any, b: any) => b.value - a.value);

          // Don't trade my best player at this position
          for (let i = 1; i < myPosPlayers.length; i++) {
            const myPlayer = myPosPlayers[i];
            const myValue = myPlayer.value;
            const valueDiff = targetValue - myValue;

            // Check if it's a fair trade (within 25%)
            if (Math.abs(valueDiff) < targetValue * 0.25) {
              const positionGainEstimate = targetValue * 0.5; // Simplified estimate
              
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
                rationale: `Trade from your strong ${myStrongPos.position} (rank ${myStrongPos.rank}, z-score ${myStrongPos.z_score.toFixed(2)}) to improve weak ${targetPosition} (rank ${targetPosStrength.rank}, z-score ${targetPosStrength.z_score.toFixed(2)}). Opponent is strong at ${targetPosition} (rank ${theirTargetPosStrength.rank}).`,
              });
            }
          }
        }
      }
    }

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
    const enrichedProposals = tradeTargets.slice(0, 10).map(t => ({
      ...t,
      estimatedRankImprovement: Math.max(1, Math.floor(t.positionGain / 20)), // Rough estimate
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
