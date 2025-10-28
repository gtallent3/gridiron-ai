import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Post-sync compute function
 * Automatically computes player values and positional strengths after league data sync
 */
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

    const { leagueId } = await req.json();

    if (!leagueId) {
      return new Response(JSON.stringify({ error: 'leagueId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Starting post-sync compute for league ${leagueId}`);

    // Step 1: Compute player values
    const { data: valuesData, error: valuesError } = await supabase.functions.invoke(
      'compute-player-values',
      {
        body: { leagueId },
        headers: { Authorization: req.headers.get('Authorization')! },
      }
    );

    if (valuesError) {
      console.error('Error computing player values:', valuesError);
      throw new Error(`Failed to compute player values: ${valuesError.message}`);
    }

    console.log(`Player values computed: ${valuesData?.playersProcessed || 0} players`);

    // Step 2: Compute positional strengths inline (more reliable)
    // Fetch teams and values
    const { data: teams, error: teamsError } = await supabase
      .from('user_teams')
      .select('team_id, roster')
      .eq('league_id', leagueId);
    if (teamsError) throw teamsError;

    const { data: playerValues, error: valuesFetchError } = await supabase
      .from('player_value_cache')
      .select('player_id, player_name, position, value_score')
      .eq('league_id', leagueId);
    if (valuesFetchError) throw valuesFetchError;

    const valueMapById = new Map<string, any>();
    const valueMapByName = new Map<string, any>();
    for (const pv of playerValues || []) {
      valueMapById.set(pv.player_id, pv);
      if (pv.player_name) valueMapByName.set(String(pv.player_name).toLowerCase().trim(), pv);
    }

    const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
    const DEFAULT_STARTERS: Record<string, number> = { QB:1, RB:2, WR:2, TE:1, FLEX:1, K:1, DST:1 };

    const normPos = (pos: any) => {
      if (typeof pos === 'number') {
        switch (pos) {
          case 1: return 'QB';
          case 2: return 'RB';
          case 3: return 'WR';
          case 4: return 'TE';
          case 5: return 'K';
          case 16: return 'DST';
          default: return String(pos).toUpperCase();
        }
      }
      const s = String(pos || '').toUpperCase();
      if (s === 'D/ST' || s === 'DST' || s === 'DEF') return 'DST';
      if (s === 'PK' || s === 'K') return 'K';
      return s;
    };

    const getValue = (p: any) => {
      const pid = p.player_id || p.playerId || p.id;
      if (pid && valueMapById.has(String(pid))) return Number(valueMapById.get(String(pid)).value_score) || 0;
      const name = (p.player_name || p.playerName || p.name || '').toLowerCase().trim();
      if (name && valueMapByName.has(name)) return Number(valueMapByName.get(name).value_score) || 0;
      return 0;
    };

    const teamPSS: Array<{ team_id: string; position: string; pss: number }> = [];

    for (const t of teams || []) {
      const roster = Array.isArray(t.roster) ? t.roster : [];
      for (const pos of positions) {
        const N = (DEFAULT_STARTERS[pos] || 1) + 1;
        const scores = roster
          .filter((p: any) => normPos(p.position) === pos)
          .map((p: any) => getValue(p))
          .sort((a: number, b: number) => b - a)
          .slice(0, N);
        const pss = scores.reduce((sum: number, v: number) => sum + v, 0);
        teamPSS.push({ team_id: t.team_id, position: pos, pss });
      }
    }

    // Rank within each position
    const strengthResults: any[] = [];
    for (const pos of positions) {
      const list = teamPSS.filter(r => r.position === pos);
      list.sort((a, b) => b.pss - a.pss);
      const values = list.map(l => l.pss);
      const mean = values.reduce((a, b) => a + b, 0) / values.length || 0;
      const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (values.length || 1);
      const std = Math.sqrt(variance);
      const median = values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)] || 0;

      let currentRank = 1;
      for (let i = 0; i < list.length; i++) {
        if (i > 0 && list[i].pss < list[i - 1].pss) currentRank = i + 1;
        strengthResults.push({
          league_id: leagueId,
          team_id: list[i].team_id,
          position: pos,
          pss: list[i].pss,
          rank: currentRank,
          z_score: std > 0 ? (list[i].pss - mean) / std : 0,
          delta_vs_median: list[i].pss - median,
          updated_at: new Date().toISOString(),
        });
      }
    }

    const { error: upsertError } = await supabase
      .from('team_positional_strengths')
      .upsert(strengthResults, { onConflict: 'league_id,team_id,position' });
    if (upsertError) throw upsertError;

    console.log(`Positional strengths computed inline: ${strengthResults.length} records`);

    return new Response(
      JSON.stringify({
        success: true,
        playerValues: {
          playersProcessed: valuesData?.playersProcessed || 0,
        },
        positionalStrengths: {
          teamsProcessed: teams?.length || 0,
        },
        message: 'Post-sync compute completed successfully',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in post-sync compute:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
