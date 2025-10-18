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
      
      // 1-for-1 trades
      const oneForOne = myRoster
        .filter((p: any) => {
          const val = getPlayerValue(p);
          return val >= targetValue * 0.85 && val <= targetValue * 1.15;
        })
        .map((p: any) => ({
          myPlayers: [p],
          theirPlayers: [targetPlayer],
          valueDiff: getPlayerValue(p) - targetValue,
          type: '1-for-1',
        }));

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
              type: '2-for-1',
            });
          }
        }
      }

      tradeProposals.push(
        ...oneForOne.slice(0, 2),
        ...twoForOne.slice(0, 2)
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

      // Look through all opponent teams
      for (const team of allTeams) {
        if (team.team_id === myTeam.team_id) continue;

        const opponentRoster = team.roster || [];

        // Find 1-for-1 matches
        const matches = opponentRoster.filter((p: any) => {
          const val = getPlayerValue(p);
          return val >= shopValue * 0.85 && val <= shopValue * 1.15;
        });

        matches.slice(0, 2).forEach((p: any) => {
          tradeProposals.push({
            myPlayers: [shopPlayer],
            theirPlayers: [p],
            theirTeam: team,
            valueDiff: getPlayerValue(p) - shopValue,
            type: '1-for-1',
          });
        });
      }
    }

    // Sort by value fairness
    tradeProposals.sort((a, b) => Math.abs(a.valueDiff) - Math.abs(b.valueDiff));

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
