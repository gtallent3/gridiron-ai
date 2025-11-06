import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Starting trade value computation...');

    // Determine current week from sleeper_projections
    const { data: projData } = await supabase
      .from('sleeper_projections')
      .select('week')
      .order('week', { ascending: true })
      .limit(1);

    if (!projData || projData.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No projection data found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const currentWeek = projData[0].week;
    console.log(`Current week: ${currentWeek}`);

    // Fetch actual fantasy points (weeks < currentWeek)
    const { data: actuals } = await supabase
      .from('nfl_fantasy_points')
      .select('player_id, player_name, position, team, week, fantasy_points_std')
      .lt('week', currentWeek);

    // Fetch ROS projections (weeks >= currentWeek)
    const { data: projections } = await supabase
      .from('sleeper_projections')
      .select('player_id, player_name, position, team, week, pts_std, ros_sos_rank, playoff_sos_rank')
      .gte('week', currentWeek);

    // Fetch bye week data
    const { data: schedules } = await supabase
      .from('team_schedules')
      .select('team, week, opponent')
      .eq('opponent', 'BYE');

    console.log(`Fetched ${actuals?.length || 0} actual records, ${projections?.length || 0} projections`);

    // Build actual points summary by player
    const actualSummary: Record<string, { recent: number; season: number }> = {};
    const byPlayerActual: Record<string, Array<{ week: number; pts: number }>> = {};

    for (const a of actuals || []) {
      if (!a.player_id || a.week >= currentWeek) continue;
      if (!byPlayerActual[a.player_id]) byPlayerActual[a.player_id] = [];
      const pts = Number(a.fantasy_points_std || 0);
      byPlayerActual[a.player_id].push({ week: a.week, pts });
    }

    for (const [pid, weeks] of Object.entries(byPlayerActual)) {
      weeks.sort((x, y) => x.week - y.week);
      const last3 = weeks.slice(-3).map(w => w.pts);
      const recent = last3.length ? last3.reduce((a, b) => a + b, 0) / last3.length : 0;
      const season = weeks.length ? weeks.reduce((a, b) => a + b.pts, 0) / weeks.length : 0;
      actualSummary[pid] = { recent, season };
    }

    // Build ROS projection summary by player - only include players with teams
    const byPlayerProj: Record<string, any> = {};
    
    for (const p of projections || []) {
      if (!p.player_id || p.week < currentWeek) continue;
      if (!p.team || p.team === '') continue; // Skip players without teams
      
      if (!byPlayerProj[p.player_id]) {
        byPlayerProj[p.player_id] = {
          player_id: p.player_id,
          player_name: p.player_name,
          position: p.position,
          team: p.team,
          projSum: 0,
          projCount: 0,
          ros_values: [] as number[],
          po_values: [] as number[],
        };
      }
      const proj = Number(p.pts_std || 0);
      byPlayerProj[p.player_id].projSum += proj;
      byPlayerProj[p.player_id].projCount += 1;

      // Collect all non-null SOS values and pick the most frequent later (mode)
      if (p.ros_sos_rank != null) {
        byPlayerProj[p.player_id].ros_values.push(Number(p.ros_sos_rank));
      }
      if (p.playoff_sos_rank != null) {
        byPlayerProj[p.player_id].po_values.push(Number(p.playoff_sos_rank));
      }
    }

    // Build bye adjustment by team
    const byeAdjByTeam: Record<string, number> = {};
    for (const s of schedules || []) {
      if (!s.team) continue;
      const bye = s.week;
      let adj = 1.0;
      if (bye && bye < currentWeek) adj = 1.05;
      else if (bye && bye >= currentWeek) adj = 0.9;
      byeAdjByTeam[s.team] = adj;
    }

    // Helper to normalize SoS rank (1-32) to -1 to +1
    const normSoS = (rank: number) => {
      if (!rank || rank < 1 || rank > 32) return 0;
      return (rank - 16.5) / 15.5;
    };

    // Pick the most frequent value (mode) among provided SOS ranks
    const pickMode = (values: number[]): number | null => {
      if (!values || values.length === 0) return null;
      const counts = new Map<number, number>();
      for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
      let best: number | null = null;
      let bestCount = 0;
      for (const [v, c] of counts.entries()) {
        if (c > bestCount) { best = v; bestCount = c; }
      }
      return best;
    };
    // Compute raw values per player
    const rows: any[] = [];

    for (const [pid, agg] of Object.entries(byPlayerProj)) {
      const { player_name, position, team, projSum, projCount, ros_values, po_values } = agg;
      if (!position || !player_name) continue;

      const projROSppg = projCount ? projSum / projCount : 0;
      const actual = actualSummary[pid] || { recent: 0, season: 0 };
      
      // Use mode of SOS ranks recorded in projections (team-level constants)
      const avgReg = pickMode(ros_values) ?? 16;
      const avgPO = pickMode(po_values) ?? 16;
      const sosRegNorm = normSoS(avgReg);
      const sosPONorm = normSoS(avgPO);

      // Position-specific scarcity multipliers (minimal impact)
      let scarcity = 1.0;
      let sosMult = 0.03;  // Reduced from 0.1-0.15
      let sosPlayoffMult = 0.05;  // Reduced from 0.08-0.25

      if (position === 'QB') {
        scarcity = 1.05;
      } else if (position === 'RB') {
        scarcity = 1.03;
      } else if (position === 'WR') {
        scarcity = 1.02;
      } else if (position === 'TE') {
        scarcity = 1.08;
      } else {
        continue;
      }

      const byeAdj = byeAdjByTeam[team] ?? 1.0;
      // Minimal SoS adjustment (max 8% swing instead of 40%)
      const sosAdj = 1 + (sosRegNorm * sosMult) + (sosPONorm * sosPlayoffMult);

      // Core formula: heavily weight ROS projection and actual season average
      // 70% ROS projection, 30% actual season average
      const baseVal = (projROSppg * 0.70) + (actual.season * 0.30);

      // Apply minimal adjustments
      let raw = baseVal * sosAdj * byeAdj * scarcity;

      // Floor for very low performers
      if (baseVal < 3) raw *= 0.5;

      rows.push({
        player_id: pid,
        player_name,
        position,
        team,
        raw_value: Math.max(raw, 0),
        meta_proj_ros_ppg: Number(projROSppg.toFixed(2)),
        meta_recent_ppg: Number((actual.recent || 0).toFixed(2)),
        meta_season_ppg: Number((actual.season || 0).toFixed(2)),
        meta_sos_reg_rank: Number(avgReg.toFixed(2)),
        meta_sos_po_rank: Number(avgPO.toFixed(2)),
        meta_bye_adj: Number(byeAdj.toFixed(3)),
        current_week: currentWeek
      });
    }

    // Sort all rows by raw_value descending for consistent ranking
    rows.sort((a, b) => b.raw_value - a.raw_value);

    // Normalize and scale ALL positions together to 1-100
    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No players to compute' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the overall top value across all positions
    const topValue = rows[0].raw_value;
    if (topValue === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid player values' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Apply logarithmic scaling to spread values from 1-100
    // This ensures top players are near 100 but not all exactly 100
    // and lower-tier players spread nicely down to 1
    const scaledOut: any[] = [];
    
    for (const r of rows) {
      if (r.raw_value === 0) {
        r.trade_value = 1;
      } else {
        // Calculate ratio relative to top player
        const ratio = r.raw_value / topValue;
        
        // Apply power curve for better distribution
        // Top player: ratio=1.0 → curved ≈ 1.0 → value ≈ 100
        // 50% of top: ratio=0.5 → curved ≈ 0.7 → value ≈ 70
        // 25% of top: ratio=0.25 → curved ≈ 0.5 → value ≈ 50
        const curved = Math.pow(ratio, 0.6);
        
        // Scale to 1-100
        let tv = 1 + (curved * 99);
        tv = Math.max(1, Math.min(tv, 100));
        r.trade_value = Number(tv.toFixed(1));
      }
      scaledOut.push(r);
    }

    // Save to trade_value_weekly
    console.log(`Inserting ${scaledOut.length} trade values...`);
    
    const { error: insertError } = await supabase
      .from('trade_value_weekly')
      .upsert(scaledOut, { onConflict: 'player_id,snapshot_date' });

    if (insertError) {
      console.error('Insert error:', insertError);
      return new Response(
        JSON.stringify({ error: insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Trade values computed successfully');

    return new Response(
      JSON.stringify({
        success: true,
        count: scaledOut.length,
        current_week: currentWeek
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error computing trade values:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
