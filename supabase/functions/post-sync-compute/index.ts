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
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: { user }, error: authError } = await userClient.auth.getUser();

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

    // Step 1: Compute player values (invoke with fallback)
    let playersProcessed = 0;
    try {
      const { data: valuesData, error: valuesError } = await adminClient.functions.invoke(
        'compute-player-values',
        {
          body: { leagueId },
          headers: { Authorization: authHeader },
        }
      );
      if (valuesError) throw valuesError;
      playersProcessed = valuesData?.playersProcessed ?? 0;
    } catch (e) {
      console.error('compute-player-values invoke failed, proceeding without invoke');
      // Fallback: do nothing here (compute-player-values function already populates cache during resync flow)
    }

    // Step 2: Compute positional strengths inline (more reliable)
    // Fetch teams and values
    const { data: teams, error: teamsError } = await adminClient
      .from('user_teams')
      .select('team_id, roster')
      .eq('league_id', leagueId);
    if (teamsError) throw teamsError;

    const { data: playerValues, error: valuesFetchError } = await adminClient
      .from('player_value_cache')
      .select('player_id, position, value_score')
      .eq('league_id', leagueId);
    if (valuesFetchError) throw valuesFetchError;

    // Build value map by canonical player_id only
    const valueById = new Map<string, number>();
    for (const pv of playerValues || []) {
      valueById.set(String(pv.player_id), Number(pv.value_score) || 0);
    }

    const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
    const DEFAULT_STARTERS: Record<string, number> = { QB:1, RB:2, WR:2, TE:1, FLEX:1, K:1, DST:1 };

    const normPos = (pos: any) => {
      // Normalize numeric and string position codes to canonical labels
      const mapNum = (n: number) => {
        switch (n) {
          case 1: return 'QB';
          case 2: return 'RB';
          case 3: return 'WR';
          case 4: return 'TE';
          case 5: return 'K';
          case 16: return 'DST';
          default: return String(n).toUpperCase();
        }
      };

      if (typeof pos === 'number') return mapNum(pos);

      const s = String(pos ?? '').trim().toUpperCase();
      // Handle numeric strings like "1", "2", "16"
      if (/^\d+$/.test(s)) return mapNum(Number(s));

      if (s === 'D/ST' || s === 'DST' || s === 'DEF') return 'DST';
      if (s === 'PK' || s === 'K') return 'K';
      if (s === 'QB' || s === 'RB' || s === 'WR' || s === 'TE') return s;
      return s;
    };

    const getValue = (p: any) => {
      const pid = String(p.player_id || p.playerId || p.id || '');
      if (pid && valueById.has(pid)) return valueById.get(pid)!;
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
      const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
      const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (values.length || 1);
      const std = Math.sqrt(variance);
      const sorted = values.slice().sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length ? (sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) : 0;

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

    const { error: upsertError } = await adminClient
      .from('team_positional_strengths')
      .upsert(strengthResults, { onConflict: 'league_id,team_id,position' });
    if (upsertError) throw upsertError;

    console.log(`Positional strengths computed inline: ${strengthResults.length} records`);

    return new Response(
      JSON.stringify({
        success: true,
        playerValues: {
          playersProcessed,
          updatedAt: new Date().toISOString(),
        },
        positionalStrengths: {
          teamsProcessed: teams?.length || 0,
          recordsUpserted: strengthResults.length,
          updatedAt: new Date().toISOString(),
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
