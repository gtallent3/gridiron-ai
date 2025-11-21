import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";

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

    // JWT is already verified by verify_jwt = true in config.toml
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

    // Inline fallback to ensure cache is populated if invoke fails
    const computePlayerValuesInline = async (): Promise<number> => {
      try {
        // Determine latest season available
        const { data: seasonRow, error: seasonErr } = await adminClient
          .from('projected_player_stats')
          .select('season')
          .order('season', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (seasonErr) console.error('Inline compute: season fetch error', seasonErr);
        const season = seasonRow?.season ?? null;

        // Fetch projections (scope to latest season if available)
        const projQuery = adminClient
          .from('projected_player_stats')
          .select('player_id, player_name, position, team, projected_fp, season');
        if (season) projQuery.eq('season', season);
        const { data: proj, error: projErr } = await projQuery;
        if (projErr || !proj?.length) {
          console.warn('Inline compute: no projections found');
          return 0;
        }

        // Aggregate ROS by player_id
        const byPlayer = new Map<string, { name: string; pos: string; team: string | null; ros: number }>();
        for (const r of proj) {
          let pid = String(r.player_id ?? '').trim();
          if (!pid) continue;
          if (/^\d+$/.test(pid)) pid = `espn_${pid}`; // canonicalize
          const pos = String(r.position ?? '').toUpperCase();
          const team = (r.team ?? null) as string | null;
          const name = r.player_name ?? '';
          const prev = byPlayer.get(pid) ?? { name, pos, team, ros: 0 };
          prev.name = prev.name || name;
          prev.pos = prev.pos || pos;
          prev.team = prev.team || team;
          prev.ros += Number(r.projected_fp ?? 0);
          byPlayer.set(pid, prev);
        }

        // Simple position weights to avoid zero values
        const W: Record<string, number> = { RB: 1.1, WR: 1.0, QB: 0.95, TE: 0.98, K: 0.6, DST: 0.6 };
        const rows = Array.from(byPlayer.entries()).map(([pid, v]) => ({
          league_id: leagueId,
          player_id: pid,
          player_name: v.name || pid,
          position: v.pos || 'FLEX',
          team: v.team,
          projected_fp_ros: v.ros,
          consistency_multiplier: 1.0,
          schedule_factor: 1.0,
          risk_adjustment: 1.0,
          value_score: v.ros * (W[v.pos] ?? 1.0),
          updated_at: new Date().toISOString(),
        }));

        const { error: upErr } = await adminClient
          .from('player_value_cache')
          .upsert(rows, { onConflict: 'league_id,player_id' });
        if (upErr) {
          console.error('Inline compute upsert error', upErr);
          return 0;
        }
        return rows.length;
      } catch (e) {
        console.error('Inline compute unexpected error', e);
        return 0;
      }
    };

    try {
      const { data: valuesData, error: valuesError } = await adminClient.functions.invoke(
        'compute-player-values',
        { body: { leagueId } }
      );
      if (valuesError) throw valuesError;
      playersProcessed = valuesData?.playersProcessed ?? 0;
    } catch (e) {
      console.error('compute-player-values invoke failed, running inline fallback', e);
      playersProcessed = await computePlayerValuesInline();
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
      .select('player_id, player_name, position, value_score')
      .eq('league_id', leagueId);
    if (valuesFetchError) throw valuesFetchError;
    console.log('post-sync counts', { teams: teams?.length ?? 0, playerValues: playerValues?.length ?? 0 });

    // Build value maps by player_id AND player_name for flexible matching
    const valueById = new Map<string, number>();
    const valueByName = new Map<string, number>();
    for (const pv of playerValues || []) {
      const id = String(pv.player_id);
      const score = Number(pv.value_score) || 0;
      valueById.set(id, score);
      // Also index by normalized name for cross-platform matching
      if (pv.player_name) {
        const normalizedName = String(pv.player_name).toLowerCase().replace(/[^a-z]/g, '');
        valueByName.set(normalizedName, score);
      }
    }

    // Build trade value map by canonical_player_id for QB/TE using player_rankings.trade_value
    const canonicalIds = new Set<string>();
    for (const t of teams || []) {
      const roster = Array.isArray(t.roster) ? t.roster : [];
      for (const p of roster as any[]) {
        const cid = String((p as any).canonical_player_id || '').trim();
        if (cid) canonicalIds.add(cid);
      }
    }

    const tradeValueByCanonicalId = new Map<string, number>();
    if (canonicalIds.size > 0) {
      const { data: tradeRows, error: tradeErr } = await adminClient
        .from('player_rankings')
        .select('player_id, trade_value')
        .in('player_id', Array.from(canonicalIds));
      if (tradeErr) throw tradeErr;
      for (const row of tradeRows || []) {
        tradeValueByCanonicalId.set(String(row.player_id), Number(row.trade_value) || 0);
      }
    }

    const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
    const DEFAULT_STARTERS: Record<string, number> = { QB:1, RB:2, WR:2, TE:1, FLEX:1, K:1, DST:1 };
    
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
    const POSITION_WEIGHTS: Record<string, number[]> = {
      RB: [1.00, 0.85, 0.55, 0.30],  // Depth matters - multiple starters + bench
      WR: [1.00, 0.85, 0.55, 0.30],  // Depth matters - multiple starters + bench
      QB: [1.0],                     // ONLY best QB counts, equals top value
      TE: [1.0],                     // ONLY best TE counts, equals top value
      K: [0.60],                     // Low impact
      DST: [0.60],                   // Low impact
    };

    // FLEX weights for leftover RB/WR/TE
    const FLEX_WEIGHTS = [0.90, 0.50];

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

    const getValue = (p: any, pos: string) => {
      // For QB and TE, use trade_value for the single best player based on canonical_player_id
      if (pos === 'QB' || pos === 'TE') {
        const canonicalId = String(p.canonical_player_id || '').trim();
        if (canonicalId && tradeValueByCanonicalId.has(canonicalId)) {
          return tradeValueByCanonicalId.get(canonicalId)!;
        }
      }

      // Default: use league-specific value scores from player_value_cache
      // Try exact player_id match first (handles both espn_ prefixed and platform-specific IDs)
      let pid = String(p.player_id || p.playerId || p.id || '').trim();
      if (pid && valueById.has(pid)) return valueById.get(pid)!;
      
      // Try with espn_ prefix for numeric IDs
      if (pid && /^\d+$/.test(pid)) {
        const espnId = `espn_${pid}`;
        if (valueById.has(espnId)) return valueById.get(espnId)!;
      }
      
      // Fallback to name matching for cross-platform compatibility (Sleeper vs ESPN IDs)
      const playerName = p.player_name || p.name || '';
      if (playerName) {
        const normalizedName = String(playerName).toLowerCase().replace(/[^a-z]/g, '');
        if (valueByName.has(normalizedName)) return valueByName.get(normalizedName)!;
      }
      
      return 0;
    };

    // Helper: Calculate PSS for a position using slot-weighted diminishing returns
    const calculatePSSForPosition = (values: number[], pos: string): number => {
      const weights = POSITION_WEIGHTS[pos] || [1.0];
      const starters = DEFAULT_STARTERS[pos] || 1;
      const bench = BENCH_DEPTH[pos] || 0;
      const totalSlots = starters + bench;
      const take = Math.min(values.length, totalSlots, weights.length);
      
      let pss = 0;
      for (let i = 0; i < take; i++) {
        pss += values[i] * weights[i];
      }
      return pss;
    };

    const teamPSS: Array<{ team_id: string; position: string; pss: number }> = [];

    for (const t of teams || []) {
      const roster = Array.isArray(t.roster) ? t.roster : [];
      
      // Build sorted value arrays for each position
      const sortedValues: Record<string, number[]> = {};
      
      for (const pos of positions) {
        const scores = roster
          .filter((p: any) => normPos(p.position) === pos)
          .map((p: any) => getValue(p, pos))
          .sort((a: number, b: number) => b - a);
        
        sortedValues[pos] = scores;
        
        // Calculate PSS using slot-weighted diminishing returns
        const pss = calculatePSSForPosition(scores, pos);
        teamPSS.push({ team_id: t.team_id, position: pos, pss });
      }

      // FLEX optimization: best remaining RB/WR/TE after starters
      const rbStarters = DEFAULT_STARTERS['RB'] || 2;
      const wrStarters = DEFAULT_STARTERS['WR'] || 2;
      const teStarters = DEFAULT_STARTERS['TE'] || 1;
      const flexSlots = DEFAULT_STARTERS['FLEX'] || 1;

      // Build FLEX candidate pool from leftover players
      const flexCandidates: number[] = [
        ...(sortedValues['RB']?.slice(rbStarters) || []),
        ...(sortedValues['WR']?.slice(wrStarters) || []),
        ...(sortedValues['TE']?.slice(teStarters) || []),
      ].sort((a: number, b: number) => b - a);

      // Calculate FLEX PSS using FLEX weights
      let flexPSS = 0;
      const flexTake = Math.min(flexSlots, FLEX_WEIGHTS.length, flexCandidates.length);
      for (let i = 0; i < flexTake; i++) {
        flexPSS += flexCandidates[i] * FLEX_WEIGHTS[i];
      }
      teamPSS.push({ team_id: t.team_id, position: 'FLEX', pss: flexPSS });
    }

    // Rank within each position (include FLEX)
    const strengthResults: any[] = [];
    const allPositions = [...positions, 'FLEX'];
    for (const pos of allPositions) {
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
