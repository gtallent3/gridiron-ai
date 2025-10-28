import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Position weights based on scarcity
const POSITION_WEIGHTS: Record<string, number> = {
  RB: 1.10,
  WR: 1.00,
  QB: 0.95,
  TE: 0.98,
  FLEX: 1.00,
  K: 0.60,
  DST: 0.60,
  'D/ST': 0.60,
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

    // Get current week
    const currentWeek = getCurrentNFLWeek();
    const season = new Date().getFullYear();

    // Fetch all projected stats for remaining weeks
    const { data: projections, error: projError } = await supabase
      .from('projected_player_stats')
      .select('*')
      .eq('season', season)
      .gte('week', currentWeek);

    if (projError) throw projError;

    // Fetch recent actual stats for consistency calculation
    const { data: actuals, error: actualsError } = await supabase
      .from('player_stats')
      .select('*')
      .eq('season', season)
      .gte('week', Math.max(1, currentWeek - 5))
      .lt('week', currentWeek)
      .eq('finalized', true);

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
      .select('*')
      .eq('league_id', leagueId);

    if (teamsError) throw teamsError;

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

    // Compute value scores
    const valueCache = [];

    for (const [playerId, projs] of playerProjections.entries()) {
      if (projs.length === 0) continue;

      const player = projs[0];
      const position = player.position;
      const posWeight = POSITION_WEIGHTS[position] || 1.0;

      // Calculate ROS projected points
      const projectedFpRos = projs.reduce((sum, p) => sum + (p.projected_fp || 0), 0);

      // Consistency multiplier (based on recent actuals variance)
      const recentActuals = playerActuals.get(playerId) || [];
      const consistencyMultiplier = calculateConsistency(recentActuals);

      // Schedule factor (simplified - default 1.0, could be enhanced with opponent data)
      const scheduleFactor = 1.0;

      // Risk adjustment (based on team context - simplified for now)
      const riskAdjustment = 1.0;

      // Final value score
      const valueScore = projectedFpRos * posWeight * consistencyMultiplier * scheduleFactor * riskAdjustment;

      valueCache.push({
        league_id: leagueId,
        player_id: playerId,
        player_name: player.player_name,
        position: position,
        team: player.team,
        value_score: valueScore,
        projected_fp_ros: projectedFpRos,
        consistency_multiplier: consistencyMultiplier,
        schedule_factor: scheduleFactor,
        risk_adjustment: riskAdjustment,
        updated_at: new Date().toISOString(),
      });
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
