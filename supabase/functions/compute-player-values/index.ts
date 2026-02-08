import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";
import { getCorsHeaders } from "../_shared/cors.ts";


// Position weights based on scarcity and roster construction
const POSITION_WEIGHTS: Record<string, number> = {
  RB: 1.30,  // Highest value - scarcest position, need 2+ starters
  WR: 1.00,  // Baseline
  QB: 0.55,  // Much lower value - only 1 starter, easily streamable
  TE: 1.10,  // Premium for top TEs
  FLEX: 1.00,
  K: 0.45,   // Minimal value
  DST: 0.45, // Minimal value
  'D/ST': 0.45,
};

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
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

    // Determine latest available season/week from projected_player_stats (not system date)
    const { data: latestSeasonRow } = await supabase
      .from('projected_player_stats')
      .select('season')
      .order('season', { ascending: false })
      .limit(1)
      .maybeSingle();

    const season = latestSeasonRow?.season ?? new Date().getFullYear();

    const { data: latestWeekRow } = await supabase
      .from('projected_player_stats')
      .select('week')
      .eq('season', season)
      .order('week', { ascending: false })
      .limit(1)
      .maybeSingle();

    const currentWeek = latestWeekRow?.week ?? 1;

    // Fetch all projected stats for remaining weeks of detected season
    const { data: projections, error: projError } = await supabase
      .from('projected_player_stats')
      .select('*')
      .eq('season', season)
      .gte('week', currentWeek);

    if (projError) throw projError;

    // Fetch recent actual stats for consistency calculation
    const { data: actuals, error: actualsError } = await supabase
      .from('actual_weekly_points')
      .select('*')
      .eq('season', season)
      .gte('week', Math.max(1, currentWeek - 5))
      .lt('week', currentWeek);

    if (actualsError) throw actualsError;

    // Get team records for risk adjustment
    const { data: league, error: leagueError } = await supabase
      .from('connected_leagues')
      .select('*')
      .eq('id', leagueId)
      .single();

    if (leagueError) throw leagueError;

    const { data: userTeams, error: teamsError } = await supabase
      .from('user_teams')
      .select('team_id, roster')
      .eq('league_id', leagueId);
    // Build roster player sets (ids and names) to restrict cache to league players
    const rosterIdSet = new Set<string>();
    const rosterNameSet = new Set<string>();
    for (const t of userTeams || []) {
      const roster = Array.isArray(t.roster) ? t.roster : [];
      for (const p of roster) {
        const pid = String(p.player_id || p.playerId || p.id || '').trim();
        const name = String(p.player_name || p.playerName || p.name || '').toLowerCase().trim();
        if (pid) rosterIdSet.add(pid);
        if (name) rosterNameSet.add(name);
      }
    }
    // Compute value scores
    const valueCache = [];

    if ((projections?.length || 0) > 0) {
      // Group projections by player
      const playerProjections = new Map<string, any[]>();
      for (const proj of projections || []) {
        const key = proj.player_id;
        if (!playerProjections.has(key)) {
          playerProjections.set(key, []);
        }
        playerProjections.get(key)!.push(proj);
      }

      // Group actuals by player
      const playerActuals = new Map<string, any[]>();
      for (const act of actuals || []) {
        const key = act.player_id;
        if (!playerActuals.has(key)) {
          playerActuals.set(key, []);
        }
        playerActuals.get(key)!.push(act);
      }

      for (const [playerId, projs] of playerProjections.entries()) {
        const sample = projs[0];
        const nameKey = String(sample.player_name || '').toLowerCase().trim();
        // Restrict to league players by id or name
        if (!rosterIdSet.has(String(playerId)) && !rosterNameSet.has(nameKey)) continue;

        const position = sample.position;
        const posWeight = POSITION_WEIGHTS[position] || 1.0;

        // Calculate ROS projected points across remaining weeks (>= currentWeek)
        const projectedFpRos = projs
          .filter(p => Number(p.week) >= currentWeek)
          .reduce((sum, p) => sum + (Number(p.projected_fp) || 0), 0);

        // Consistency multiplier (based on recent actuals variance)
        const recentActuals = playerActuals.get(playerId) || [];
        const consistencyMultiplier = calculateConsistency(recentActuals);

        const scheduleFactor = 1.0;
        const riskAdjustment = 1.0;

        const valueScore = projectedFpRos * posWeight * consistencyMultiplier * scheduleFactor * riskAdjustment;

        valueCache.push({
          league_id: leagueId,
          player_id: playerId,
          player_name: sample.player_name,
          position: position,
          team: sample.team,
          value_score: valueScore,
          projected_fp_ros: projectedFpRos,
          consistency_multiplier: consistencyMultiplier,
          schedule_factor: scheduleFactor,
          risk_adjustment: riskAdjustment,
          updated_at: new Date().toISOString(),
        });
      }
    } else {
      console.warn('No weekly projections found in projected_player_stats for season/week; nothing to compute.');
    }

    // Upsert to cache
    if (valueCache.length > 0) {
      const { error: upsertError } = await supabase
        .from('player_value_cache')
        .upsert(valueCache, { onConflict: 'league_id,player_id' });

      if (upsertError) throw upsertError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        playersProcessed: valueCache.length,
        message: 'Player values computed and cached',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error computing player values:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function calculateConsistency(actuals: any[]): number {
  if (actuals.length < 2) return 1.0;

  // Calculate points from stats for each game
  const points = actuals.map(a => {
    const stats = a.stats || {};
    // Simple PPR calculation
    return (
      (stats.passing_yards || 0) * 0.04 +
      (stats.passing_tds || 0) * 4 +
      (stats.interceptions || 0) * -2 +
      (stats.rushing_yards || 0) * 0.1 +
      (stats.rushing_tds || 0) * 6 +
      (stats.receptions || 0) * 1 +
      (stats.receiving_yards || 0) * 0.1 +
      (stats.receiving_tds || 0) * 6 +
      (stats.fumbles_lost || 0) * -2
    );
  });

  const mean = points.reduce((a, b) => a + b, 0) / points.length;
  const variance = points.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / points.length;
  const stdDev = Math.sqrt(variance);

  // Coefficient of variation (CV) - lower is more consistent
  const cv = mean > 0 ? stdDev / mean : 0;

  // Convert to multiplier: 0.95-1.05 range
  // Low CV (< 0.3) = 1.05, High CV (> 0.7) = 0.95
  if (cv < 0.3) return 1.05;
  if (cv > 0.7) return 0.95;
  return 1.0;
}

function getCurrentNFLWeek(): number {
  const now = new Date();
  const seasonStart = new Date(now.getFullYear(), 8, 1); // Sept 1
  const weeksSinceStart = Math.floor((now.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return Math.max(1, Math.min(18, weeksSinceStart + 1));
}
