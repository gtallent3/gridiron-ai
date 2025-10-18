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

    // Get player valuations
    const now = new Date();
    const currentWeek = Math.min(Math.floor((now.getTime() - new Date(now.getFullYear(), 8, 1).getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1, 18);
    const currentSeason = now.getFullYear();

    const { data: valuations } = await supabase
      .from('player_valuations')
      .select('*')
      .eq('season', currentSeason)
      .eq('week', currentWeek);

    const valuationMap = new Map((valuations || []).map(v => [v.player_id, v]));

    const getPlayerValue = (player: any) => {
      const val = valuationMap.get(player.id || player.player_id);
      if (!val) return (player.projected || 0) * 10;
      const posWeight = POSITION_WEIGHTS[val.position as keyof typeof POSITION_WEIGHTS] || 1;
      return Number(val.player_value) * posWeight;
    };

    // Calculate position strength
    const myRoster = myTeam.roster || [];
    const myPositionPlayers = myRoster.filter((p: any) => p.position === targetPosition);
    const myPosStrength = myPositionPlayers
      .sort((a: any, b: any) => getPlayerValue(b) - getPlayerValue(a))
      .slice(0, 3) // Top 3 at position
      .reduce((sum: number, p: any) => sum + getPlayerValue(p), 0);

    // Calculate league average for this position
    const allRosters = allTeams.map((t: any) => t.roster || []);
    const leagueAvgPos = allRosters
      .map((roster: any[]) => {
        const posPlayers = roster.filter((p: any) => p.position === targetPosition);
        return posPlayers
          .sort((a: any, b: any) => getPlayerValue(b) - getPlayerValue(a))
          .slice(0, 3)
          .reduce((sum: number, p: any) => sum + getPlayerValue(p), 0);
      })
      .reduce((sum: number, val: number) => sum + val, 0) / allRosters.length;

    const posStrengthGap = leagueAvgPos - myPosStrength;

    console.log(`Position ${targetPosition}: My ${myPosStrength.toFixed(1)}, Avg ${leagueAvgPos.toFixed(1)}, Gap ${posStrengthGap.toFixed(1)}`);

    // Find teams with surplus at target position
    const tradeTargets: any[] = [];

    for (const team of allTeams) {
      if (team.team_id === myTeam.team_id) continue;

      const theirRoster = team.roster || [];
      const theirPosPlayers = theirRoster
        .filter((p: any) => p.position === targetPosition)
        .sort((a: any, b: any) => getPlayerValue(b) - getPlayerValue(a));

      if (theirPosPlayers.length < 3) continue; // Need surplus

      // Check if they have surplus at target position
      const theirPosStrength = theirPosPlayers.slice(0, 3)
        .reduce((sum: number, p: any) => sum + getPlayerValue(p), 0);

      if (theirPosStrength <= leagueAvgPos * 1.1) continue; // No real surplus

      // Find what positions I have surplus in
      const myPositions: Record<string, any[]> = {};
      myRoster.forEach((p: any) => {
        if (!myPositions[p.position]) myPositions[p.position] = [];
        myPositions[p.position].push(p);
      });

      // Try to find fair trades
      for (const targetPlayerIdx of [2, 3, 4]) { // Their 3rd, 4th, 5th best at position
        if (targetPlayerIdx >= theirPosPlayers.length) continue;
        
        const targetPlayer = theirPosPlayers[targetPlayerIdx];
        const targetValue = getPlayerValue(targetPlayer);

        // Look for matches from my other positions
        for (const [pos, players] of Object.entries(myPositions)) {
          if (pos === targetPosition) continue; // Don't trade same position

          const sorted = players.sort((a, b) => getPlayerValue(b) - getPlayerValue(a));
          
          for (const myPlayer of sorted.slice(1)) { // Not my best
            const myValue = getPlayerValue(myPlayer);
            const valueDiff = targetValue - myValue;

            if (Math.abs(valueDiff) < targetValue * 0.2) { // Within 20%
              const posGain = targetValue - (myPositionPlayers[Math.min(myPositionPlayers.length - 1, 2)] 
                ? getPlayerValue(myPositionPlayers[Math.min(myPositionPlayers.length - 1, 2)]) 
                : 0);

              tradeTargets.push({
                myPlayers: [myPlayer],
                theirPlayers: [targetPlayer],
                theirTeam: team,
                valueDiff,
                positionGain: posGain,
                rationale: `Upgrade ${targetPosition} by ${posGain.toFixed(1)} pts, trade away surplus ${pos}`,
              });
            }
          }
        }
      }
    }

    // Sort by position gain
    tradeTargets.sort((a, b) => b.positionGain - a.positionGain);

    return new Response(
      JSON.stringify({ 
        targetPosition,
        myPosStrength: myPosStrength.toFixed(1),
        leagueAvgPos: leagueAvgPos.toFixed(1),
        posStrengthGap: posStrengthGap.toFixed(1),
        needsUpgrade: posStrengthGap > 10,
        proposals: tradeTargets.slice(0, 10),
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
