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

    // Determine current week from actual stats (max week with actuals)
    const { data: actualsWeek } = await supabase
      .from('nfl_fantasy_points')
      .select('week')
      .eq('season', 2025)
      .order('week', { ascending: false })
      .limit(1);

    if (!actualsWeek || actualsWeek.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No actual stats found to determine current week' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const lastCompletedWeek = actualsWeek[0].week;
    const currentWeek = lastCompletedWeek + 1;
    console.log(`Current week: ${currentWeek} (last completed: ${lastCompletedWeek})`);

    // Fetch actual PPR fantasy points (completed weeks only)
    const { data: actuals } = await supabase
      .from('nfl_fantasy_points')
      .select('player_id, player_name, position, team, week, fantasy_points_ppr')
      .eq('season', 2025)
      .lte('week', lastCompletedWeek);

    // Fetch projected PPR points for remaining season
    const { data: projections } = await supabase
      .from('sleeper_projections')
      .select('player_id, player_name, position, team, week, pts_ppr')
      .eq('season', 2025)
      .gte('week', currentWeek);

    console.log(`Fetched ${actuals?.length || 0} actual PPR records, ${projections?.length || 0} projected PPR records`);

    // Build actual points by player
    const playerData: Record<string, {
      player_id: string;
      player_name: string;
      position: string;
      team: string;
      actual_weeks: number[];
      actual_total: number;
      projected_weeks: number[];
      projected_total: number;
    }> = {};

    // Process actuals
    for (const a of actuals || []) {
      if (!a.player_id || !a.player_name || !a.position) continue;
      
      if (!playerData[a.player_id]) {
        playerData[a.player_id] = {
          player_id: a.player_id,
          player_name: a.player_name,
          position: a.position,
          team: a.team || '',
          actual_weeks: [],
          actual_total: 0,
          projected_weeks: [],
          projected_total: 0,
        };
      }
      
      const pts = Number(a.fantasy_points_ppr || 0);
      playerData[a.player_id].actual_weeks.push(a.week);
      playerData[a.player_id].actual_total += pts;
    }

    // Process projections
    for (const p of projections || []) {
      if (!p.player_id || !p.player_name || !p.position) continue;
      
      if (!playerData[p.player_id]) {
        playerData[p.player_id] = {
          player_id: p.player_id,
          player_name: p.player_name,
          position: p.position,
          team: p.team || '',
          actual_weeks: [],
          actual_total: 0,
          projected_weeks: [],
          projected_total: 0,
        };
      }
      
      const pts = Number(p.pts_ppr || 0);
      playerData[p.player_id].projected_weeks.push(p.week);
      playerData[p.player_id].projected_total += pts;
      
      // Update team if missing from actuals
      if (!playerData[p.player_id].team && p.team) {
        playerData[p.player_id].team = p.team;
      }
    }

    // Compute trade values
    const rows: any[] = [];
    
    for (const [pid, data] of Object.entries(playerData)) {
      // Skip if no position or invalid position
      if (!data.position || !['QB', 'RB', 'WR', 'TE'].includes(data.position)) continue;
      
      // Skip if no team (FA/retired players)
      if (!data.team || data.team === '') continue;
      
      // Calculate actual PPG
      const actualPPG = data.actual_weeks.length > 0 
        ? data.actual_total / data.actual_weeks.length 
        : 0;
      
      // Calculate projected PPG for ROS
      const projectedPPG = data.projected_weeks.length > 0 
        ? data.projected_total / data.projected_weeks.length 
        : 0;
      
      // Skip players with no data
      if (actualPPG === 0 && projectedPPG === 0) continue;
      
      // Trade value calculation:
      // If player has both actual and projected: weight 60% projected, 40% actual
      // If only projected (rookies, etc): use projected only
      // If only actual (injured/no projections): use actual only
      let tradeValue: number;
      
      if (data.actual_weeks.length > 0 && data.projected_weeks.length > 0) {
        tradeValue = (projectedPPG * 0.6) + (actualPPG * 0.4);
      } else if (data.projected_weeks.length > 0) {
        tradeValue = projectedPPG;
      } else {
        tradeValue = actualPPG;
      }
      
      // Calculate last 3 weeks PPG for meta_recent_ppg
      const recentWeeks = data.actual_weeks.slice(-3);
      let recentPPG = 0;
      if (recentWeeks.length > 0) {
        let recentTotal = 0;
        for (const a of actuals || []) {
          if (a.player_id === pid && recentWeeks.includes(a.week)) {
            recentTotal += Number(a.fantasy_points_ppr || 0);
          }
        }
        recentPPG = recentTotal / recentWeeks.length;
      }
      
      rows.push({
        player_id: pid,
        player_name: data.player_name,
        position: data.position,
        team: data.team,
        trade_value: Number(tradeValue.toFixed(2)),
        raw_value: Number(tradeValue.toFixed(2)),
        meta_proj_ros_ppg: Number(projectedPPG.toFixed(2)),
        meta_recent_ppg: Number(recentPPG.toFixed(2)),
        meta_season_ppg: Number(actualPPG.toFixed(2)),
        meta_sos_reg_rank: null,
        meta_sos_po_rank: null,
        meta_bye_adj: null,
        snapshot_date: new Date().toISOString().slice(0, 10),
        current_week: currentWeek
      });
    }

    // Sort by trade value descending
    rows.sort((a, b) => b.trade_value - a.trade_value);
    
    console.log(`Computed trade values for ${rows.length} players`);

    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No players to compute' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Save to trade_value_weekly - delete today's snapshot first
    const today = new Date().toISOString().slice(0, 10);
    console.log(`Deleting existing records for snapshot_date: ${today}`);
    
    const { error: deleteError } = await supabase
      .from('trade_value_weekly')
      .delete()
      .eq('snapshot_date', today);
    
    if (deleteError) {
      console.error('Delete error:', deleteError);
      return new Response(
        JSON.stringify({ error: `Failed to clear existing records: ${deleteError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Inserting ${rows.length} trade values...`);
    
    const { error: insertError } = await supabase
      .from('trade_value_weekly')
      .insert(rows);

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
        count: rows.length,
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
