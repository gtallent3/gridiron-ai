// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Starting Trade Value Index (VORP-based) computation...");
    console.log("Using weighted actual PPG: 60% last 3 weeks + 40% season excluding last 3");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Fetch all player rankings
    const { data: rankings, error: fetchError } = await supabase
      .from("player_rankings")
      .select("*");

    if (fetchError) {
      console.error("Error fetching player rankings:", fetchError);
      throw fetchError;
    }
    if (!rankings || rankings.length === 0) {
      return new Response(
        JSON.stringify({ message: "No player rankings found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Helper to normalize SoS 1-32 → -1..+1 (center at 16.5)
    const normSoS = (rank: number | null): number => {
      if (rank && rank >= 1 && rank <= 32) {
        return (rank - 16.5) / 15.5;
      }
      return 0;
    };

    // Current week (max across rows)
    const currentWeek = rankings.reduce(
      (max, r) => Math.max(max, Number(r.current_week ?? 0)),
      0,
    );
    console.log(`Current week detected: ${currentWeek}`);

    // === CONFIG (can be overridden via env) ============================
    // Replacement indices (0-based ranking within a position after sorting by baseline desc)
    const REPL_IDX_QB = Number(Deno.env.get("REPL_IDX_QB") ?? 12);
    const REPL_IDX_RB = Number(Deno.env.get("REPL_IDX_RB") ?? 24);
    const REPL_IDX_WR = Number(Deno.env.get("REPL_IDX_WR") ?? 30);
    const REPL_IDX_TE = Number(Deno.env.get("REPL_IDX_TE") ?? 12);

    // Position-specific multipliers, scarcity, caps, calibration targets
    const POS_CONF: Record<string, {
      wProj: number; wActual: number;
      sosMult: number; sosPlayoffMult: number;
      scarcity: number;   // boosts or reduces the position
      posMax: number;     // max trade value after scaling
      topN: number;       // how many to calibrate against
      targetAvg: number;  // desired average for topN after scaling
    }> = {
      QB: { wProj: 0.50, wActual: 0.50, sosMult: 0.12, sosPlayoffMult: 0.20, scarcity: 1.10, posMax: 50,  topN: 20, targetAvg: 20 },
      RB: { wProj: 0.30, wActual: 0.70, sosMult: 0.10, sosPlayoffMult: 0.17, scarcity: 1.35, posMax: 110, topN: 30, targetAvg: 36 },
      WR: { wProj: 0.40, wActual: 0.60, sosMult: 0.06, sosPlayoffMult: 0.10, scarcity: 0.95, posMax: 90,  topN: 30, targetAvg: 27 },
      TE: { wProj: 0.60, wActual: 0.40, sosMult: 0.04, sosPlayoffMult: 0.06, scarcity: 1.25, posMax: 50,  topN: 20, targetAvg: 20 },
    };

    // Low-PPG reduction: if avg_projected_ppg_ros < threshold, scale down
    const LOW_PPG_THRESHOLD = Number(Deno.env.get("LOW_PPG_THRESHOLD") ?? 8);
    const LOW_PPG_FACTOR = Number(Deno.env.get("LOW_PPG_FACTOR") ?? 0.25);

    // Bye week adjustments
    const BYE_DONE_BOOST = Number(Deno.env.get("BYE_DONE_BOOST") ?? 1.05);
    const BYE_AHEAD_PENALTY = Number(Deno.env.get("BYE_AHEAD_PENALTY") ?? 0.90);
    // ================================================================

    // Build a per-position map of players with baseline PPG
    type Row = {
      player_id: string;
      player_name: string;
      position: string;
      team: string | null;
      avg_projected_ppg_ros: number | null;
      avg_actual_ppg: number | null;
      actual_last3_ppg: number | null;
      actual_season_ppg: number | null;
      ros_sos_rank: number | null;
      playoff_sos_rank: number | null;
      bye_week: number | null;
    };

    const rows: Array<Row & { baseline: number }> = [];
    let debugSampleCount = 0;
    for (const p of rankings as Row[]) {
      if (!p.player_name || !p.position) continue;
      const cfg = POS_CONF[p.position];
      if (!cfg) continue;

      // Calculate weighted actual PPG: 60% last 3 weeks, 40% season (excluding last 3)
      const last3 = Number(p.actual_last3_ppg ?? 0);
      const season = Number(p.actual_season_ppg ?? 0);
      const actualWeighted = (last3 * 0.60) + (season * 0.40);
      
      // If no last 3 week data, fallback to avg_actual_ppg
      const finalActual = (last3 === 0 && season === 0) 
        ? Number(p.avg_actual_ppg ?? 0) 
        : actualWeighted;

      const baseline =
        (Number(p.avg_projected_ppg_ros ?? 0) * cfg.wProj) +
        (finalActual * cfg.wActual);

      // Debug log first 3 players with weighted actuals
      if (debugSampleCount < 3 && last3 > 0) {
        console.log(`Weighted actual sample - ${p.player_name}: last3=${last3.toFixed(2)}, season=${season.toFixed(2)}, weighted=${actualWeighted.toFixed(2)}, final=${finalActual.toFixed(2)}`);
        debugSampleCount++;
      }

      rows.push({ ...p, baseline });
    }

    // Group by position
    const byPos: Record<string, typeof rows> = rows.reduce((acc, r) => {
      (acc[r.position] ||= []).push(r);
      return acc;
    }, {} as Record<string, typeof rows>);

    // Determine replacement PPG per position (use baseline PPG sorted desc)
    const replPPG: Record<string, number> = {};
    const replIdxByPos: Record<string, number> = {
      QB: REPL_IDX_QB, RB: REPL_IDX_RB, WR: REPL_IDX_WR, TE: REPL_IDX_TE,
    };

    for (const pos of Object.keys(POS_CONF)) {
      const arr = (byPos[pos] ?? []).slice().sort((a, b) => b.baseline - a.baseline);
      const idx = Math.min(Math.max(0, replIdxByPos[pos]), Math.max(0, arr.length - 1));
      const v = arr[idx]?.baseline ?? 0;
      replPPG[pos] = v;
      console.log(`Replacement PPG for ${pos} @ index ${idx} = ${v.toFixed(3)} (count=${arr.length})`);
    }

    // Compute raw trade values using VORP
    type RawOut = {
      player_id: string;
      player_name: string;
      position: string;
      team: string | null;
      raw_value: number;
    };

    const rawRows: RawOut[] = [];

    for (const p of rows) {
      const pos = p.position;
      const cfg = POS_CONF[pos];
      if (!cfg) continue;

      const baseline = p.baseline;
      const posRepl = replPPG[pos] ?? 0;
      // VORP baseline
      const vorp = Math.max(0, baseline - posRepl);

      // SoS adjustments (smaller for WR, stronger for RB per cfg)
      const sosAdj =
        (1 + normSoS(p.ros_sos_rank) * cfg.sosMult) *
        (1 + normSoS(p.playoff_sos_rank) * cfg.sosPlayoffMult);

      // Bye adjustments
      let byeAdj = 1.0;
      if (p.bye_week) {
        if (p.bye_week < currentWeek) byeAdj = BYE_DONE_BOOST;
        else byeAdj = BYE_AHEAD_PENALTY;
      }

      // Low-projection floor
      const lowProjPenalty = (Number(p.avg_projected_ppg_ros ?? 0) < LOW_PPG_THRESHOLD)
        ? LOW_PPG_FACTOR : 1.0;

      // Combine
      const raw = vorp * cfg.scarcity * sosAdj * byeAdj * lowProjPenalty;

      rawRows.push({
        player_id: p.player_id,
        player_name: p.player_name,
        position: p.position,
        team: p.team,
        raw_value: Number(raw.toFixed(6)),
      });
    }

    // Normalize/scaling per position
    const updates: Array<{ player_id: string; trade_value: number }> = [];
    for (const pos of Object.keys(POS_CONF)) {
      const cfg = POS_CONF[pos];
      const list = rawRows.filter(r => r.position === pos);
      if (list.length === 0) continue;

      const vals = list.map(r => r.raw_value);
      const minV = Math.min(...vals);
      const maxV = Math.max(...vals);
      const range = Math.max(1e-9, maxV - minV);

      // Normalize 0..1
      for (const r of list) {
        (r as any).norm = (r.raw_value - minV) / range;
      }

      // Scale to [1..posMax]
      for (const r of list) {
        (r as any).trade_value = 1 + (r as any).norm * (cfg.posMax - 1);
      }

      // Calibrate the top N to target average
      const sorted = [...list].sort((a, b) => (b as any).trade_value - (a as any).trade_value);
      const top = sorted.slice(0, Math.min(cfg.topN, sorted.length));
      const currentAvg = top.reduce((a, b) => a + (b as any).trade_value, 0) / Math.max(top.length, 1);
      const factor = currentAvg > 0 ? (cfg.targetAvg / currentAvg) : 1;

      for (const r of list) {
        let tv = (r as any).trade_value * factor;
        tv = Math.max(1, Math.min(tv, cfg.posMax));
        updates.push({ player_id: r.player_id, trade_value: Number(tv.toFixed(2)) });
      }

      console.log(
        `[${pos}] min=${minV.toFixed(3)} max=${maxV.toFixed(3)} → calibrated top${cfg.topN} to avg≈${cfg.targetAvg}`,
      );
    }

    // Batch updates
    console.log(`Updating ${updates.length} player trade values...`);
    const batchSize = 100;
    let updated = 0;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      for (const u of batch) {
        const { error: updateError } = await supabase
          .from("player_rankings")
          .update({ trade_value: u.trade_value })
          .eq("player_id", u.player_id);
        if (updateError) {
          console.error(`Error updating ${u.player_id}:`, updateError);
        } else {
          updated++;
        }
      }
      console.log(`Updated ${Math.min(i + batchSize, updates.length)} / ${updates.length}`);
    }

    console.log(`Successfully updated ${updated} player trade values`);
    return new Response(
      JSON.stringify({
        success: true,
        message: `Trade values computed (VORP) and updated for ${updated} players`,
        playersProcessed: updated,
        currentWeek,
        replacementPPG: replPPG,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in compute-trade-value-index (VORP):", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
