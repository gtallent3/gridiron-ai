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
          sosRanksRegular: [],
          sosRanksPlayoff: []
        };
      }
      const proj = Number(p.pts_std || 0);
      byPlayerProj[p.player_id].projSum += proj;
      byPlayerProj[p.player_id].projCount += 1;

      const sosRank = Number(p.ros_sos_rank || 16);
      const playoffSosRank = Number(p.playoff_sos_rank || 16);
      
      if ([15, 16, 17].includes(p.week)) {
        byPlayerProj[p.player_id].sosRanksPlayoff.push(playoffSosRank);
      } else {
        byPlayerProj[p.player_id].sosRanksRegular.push(sosRank);
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

    // Compute raw values per player
    const rows: any[] = [];

    for (const [pid, agg] of Object.entries(byPlayerProj)) {
      const { player_name, position, team, projSum, projCount, sosRanksRegular, sosRanksPlayoff } = agg;
      if (!position || !player_name) continue;

      const projROSppg = projCount ? projSum / projCount : 0;
      const actual = actualSummary[pid] || { recent: 0, season: 0 };
      const ppgRecentSeason = (actual.recent * 0.5 + actual.season * 0.5) || actual.season || 0;

      const avgReg = sosRanksRegular.length ? sosRanksRegular.reduce((a: number, b: number) => a + b, 0) / sosRanksRegular.length : 16;
      const avgPO = sosRanksPlayoff.length ? sosRanksPlayoff.reduce((a: number, b: number) => a + b, 0) / sosRanksPlayoff.length : 16;
      const sosRegNorm = normSoS(avgReg);
      const sosPONorm = normSoS(avgPO);

      // Position-specific weights
      let wRecent = 0.5, wSeason = 0.5, wProj = 0.5;
      let sosMult = 0.1, sosPlayoffMult = 0.1;
      let scarcity = 1.0;

      if (position === 'QB') {
        wRecent = 0.4; wSeason = 0.6; wProj = 0.5;
        sosMult = 0.15; sosPlayoffMult = 0.25;
        scarcity = 1.4;
      } else if (position === 'RB') {
        wRecent = 0.7; wSeason = 0.3; wProj = 0.3;
        sosMult = 0.10; sosPlayoffMult = 0.17;
        scarcity = 1.10;
      } else if (position === 'WR') {
        wRecent = 0.6; wSeason = 0.4; wProj = 0.4;
        sosMult = 0.12; sosPlayoffMult = 0.20;
        scarcity = 1.05;
      } else if (position === 'TE') {
        wRecent = 0.6; wSeason = 0.4; wProj = 0.6;
        sosMult = 0.05; sosPlayoffMult = 0.08;
        scarcity = 1.5;
      } else {
        continue;
      }

      const byeAdj = byeAdjByTeam[team] ?? 1.0;
      const sosAdj = 1 + (sosRegNorm * sosMult) + (sosPONorm * sosPlayoffMult);

      const baseline = (actual.recent * wRecent) + (actual.season * wSeason);
      const baseVal = (projROSppg * wProj) + (baseline * (1 - wProj));

      let raw = baseVal * sosAdj * byeAdj * scarcity;

      // Floor for low-PPG players
      if ((actual.recent || actual.season) && ppgRecentSeason < 8) raw *= 0.25;

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

    // Normalize and scale by position using fixed baselines
    const byPos: Record<string, any[]> = {};
    for (const r of rows) {
      if (!byPos[r.position]) byPos[r.position] = [];
      byPos[r.position].push(r);
    }

    const scaledOut: any[] = [];

    for (const [pos, list] of Object.entries(byPos)) {
      if (list.length === 0) continue;

      // Sort by raw value for deterministic ordering
      list.sort((a, b) => b.raw_value - a.raw_value);

      const posMax = (pos === 'QB' || pos === 'TE') ? 50 : 100;
      const topN = (pos === 'QB' || pos === 'TE') ? 20 : 30;
      
      // Use fixed baseline: top player = posMax, scale down from there
      const topValue = list[0].raw_value;
      if (topValue === 0) continue;

      // Assign values proportionally to raw_value, with top player = posMax
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        // Use exponential decay to spread values: top players get high values, bottom gets ~1
        const ratio = r.raw_value / topValue;
        // Apply power curve to create better separation at top
        const curved = Math.pow(ratio, 0.7);
        let tv = 1 + (curved * (posMax - 1));
        tv = Math.max(1, Math.min(tv, posMax));
        r.trade_value = Number(tv.toFixed(2));
        scaledOut.push(r);
      }
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
