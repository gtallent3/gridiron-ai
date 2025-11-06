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

    // Fetch team-level SOS as fallback
    const { data: teamSOS } = await supabase
      .from('team_sos')
      .select('team, position, ros_sos_rank, playoff_sos_rank');

    const teamSOSMap: Record<string, { ros: number | null; po: number | null }> = {};
    for (const row of teamSOS || []) {
      // @ts-ignore - row is a generic object from Supabase
      if (!row.team || !row.position) continue;
      // @ts-ignore - access fields from row
      teamSOSMap[`${row.team}-${row.position}`] = {
        // @ts-ignore
        ros: row.ros_sos_rank ?? null,
        // @ts-ignore
        po: row.playoff_sos_rank ?? null,
      };
    }

    console.log(`Fetched ${actuals?.length || 0} actual records, ${projections?.length || 0} projections, ${teamSOS?.length || 0} team SOS`);
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
    let week15Count = 0;
    let week15WithSOS = 0;
    
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
          // Keep week 15 explicitly when available and also collect all values
          ros_sos_rank_w15: null as number | null,
          playoff_sos_rank_w15: null as number | null,
          ros_values: [] as number[],
          po_values: [] as number[],
        };
      }
      const proj = Number(p.pts_std || 0);
      byPlayerProj[p.player_id].projSum += proj;
      byPlayerProj[p.player_id].projCount += 1;

      // Always collect values across weeks
      if (p.ros_sos_rank != null) byPlayerProj[p.player_id].ros_values.push(Number(p.ros_sos_rank));
      if (p.playoff_sos_rank != null) byPlayerProj[p.player_id].po_values.push(Number(p.playoff_sos_rank));

      // Prefer week 15 SOS values (byes end at week 14)
      if (p.week === 15) {
        week15Count++;
        if (p.ros_sos_rank != null) {
          byPlayerProj[p.player_id].ros_sos_rank_w15 = Number(p.ros_sos_rank);
          week15WithSOS++;
        }
        if (p.playoff_sos_rank != null) {
          byPlayerProj[p.player_id].playoff_sos_rank_w15 = Number(p.playoff_sos_rank);
        }
      }
    }

    console.log(`Processed ${week15Count} week 15 records, ${week15WithSOS} had SOS data`);
    
    // Sample a few players to check SOS values
    const samplePlayers = Object.values(byPlayerProj).slice(0, 3);
    for (const sp of samplePlayers) {
      console.log(`Sample: ${sp.player_name} - W15 ROS: ${sp.ros_sos_rank_w15}, W15 PO: ${sp.playoff_sos_rank_w15}, All ROS: [${sp.ros_values.slice(0,3).join(',')}], All PO: [${sp.po_values.slice(0,3).join(',')}]`);
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
    let defaultedToSixteen = 0;
    let usedWeek15 = 0;
    let usedMode = 0;
    let usedTeamSOS = 0;

    for (const [pid, agg] of Object.entries(byPlayerProj)) {
      const { player_name, position, team, projSum, projCount, ros_sos_rank_w15, playoff_sos_rank_w15, ros_values, po_values } = agg;
      if (!position || !player_name) continue;

      const projROSppg = projCount ? projSum / projCount : 0;
      const actual = actualSummary[pid] || { recent: 0, season: 0 };
      
      // Prefer week 15 SOS ranks; fall back to mode across weeks; then team-level SOS; default 16
      const key = `${team}-${position}`;
      const teamFallbackReg = teamSOSMap[key]?.ros ?? null;
      const teamFallbackPO = teamSOSMap[key]?.po ?? null;

      const avgReg = (ros_sos_rank_w15 ?? pickMode(ros_values) ?? teamFallbackReg ?? 16);
      const avgPO = (playoff_sos_rank_w15 ?? pickMode(po_values) ?? teamFallbackPO ?? 16);
      
      // Track which source was used
      if (ros_sos_rank_w15 != null) usedWeek15++;
      else if (pickMode(ros_values) != null) usedMode++;
      else if (teamFallbackReg != null) usedTeamSOS++;
      else defaultedToSixteen++;
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
    console.log(`SOS source breakdown: Week15=${usedWeek15}, Mode=${usedMode}, TeamSOS=${usedTeamSOS}, Default16=${defaultedToSixteen}`);

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
