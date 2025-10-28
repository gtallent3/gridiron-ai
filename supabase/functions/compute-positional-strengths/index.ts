import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Default lineup requirements
const DEFAULT_STARTERS: Record<string, number> = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  FLEX: 1,
  K: 1,
  DST: 1,
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

    // Fetch all teams in the league
    const { data: teams, error: teamsError } = await supabase
      .from('user_teams')
      .select('*')
      .eq('league_id', leagueId);

    if (teamsError) throw teamsError;

    // Fetch player value cache for this league
    const { data: playerValues, error: valuesError } = await supabase
      .from('player_value_cache')
      .select('*')
      .eq('league_id', leagueId);

    if (valuesError) throw valuesError;

    // Build player value maps (by id and by name)
    const valueMapById = new Map<string, any>();
    const valueMapByName = new Map<string, any>();
    for (const pv of playerValues || []) {
      valueMapById.set(pv.player_id, pv);
      if (pv.player_name) valueMapByName.set(String(pv.player_name).toLowerCase().trim(), pv);
    }

    // Calculate PSS for each team and position
    const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
    const teamPSS: Map<string, Map<string, number>> = new Map();

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

    const getValueForPlayer = (p: any) => {
      const pid = p.player_id || p.playerId || p.id;
      if (pid && valueMapById.has(String(pid))) return valueMapById.get(String(pid));
      const name = (p.player_name || p.playerName || p.name || '').toLowerCase().trim();
      if (name && valueMapByName.has(name)) return valueMapByName.get(name);
      return null;
    };

    for (const team of teams || []) {
      const roster = (team.roster as any[]) || [];
      const teamMap = new Map<string, number>();

      for (const pos of positions) {
        const N = (DEFAULT_STARTERS[pos] || 1) + 1; // starters + 1 bench
        
        // Get all players at this position
        const posPlayers = roster
          .filter(p => normPos(p.position) === pos)
          .map(p => {
            const value = getValueForPlayer(p);
            return value ? Number(value.value_score) || 0 : 0;
          })
          .sort((a, b) => b - a); // descending

        // Sum top N
        const pss = posPlayers.slice(0, N).reduce((sum, v) => sum + v, 0);
        teamMap.set(pos, pss);
      }

      teamPSS.set(team.team_id, teamMap);
    }

    // Calculate league-wide stats per position and assign ranks
    const strengthResults = [];

    for (const pos of positions) {
      // Create array of {teamId, pss} for proper ranking
      const teamPSSArray: Array<{ teamId: string; pss: number }> = [];
      for (const [teamId, teamMap] of teamPSS.entries()) {
        teamPSSArray.push({
          teamId,
          pss: teamMap.get(pos) || 0,
        });
      }

      // Sort by PSS descending
      teamPSSArray.sort((a, b) => b.pss - a.pss);

      // Calculate stats
      const allPSS = teamPSSArray.map(t => t.pss);
      const mean = allPSS.reduce((a, b) => a + b, 0) / allPSS.length;
      const variance = allPSS.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / allPSS.length;
      const stdDev = Math.sqrt(variance);
      const median = calculateMedian(allPSS);

      // Assign ranks (with tie-breaking: same PSS = same rank)
      let currentRank = 1;
      for (let i = 0; i < teamPSSArray.length; i++) {
        const team = teamPSSArray[i];
        
        // If not the first and PSS differs from previous, increment rank
        if (i > 0 && team.pss < teamPSSArray[i - 1].pss) {
          currentRank = i + 1;
        }

        const zScore = stdDev > 0 ? (team.pss - mean) / stdDev : 0;
        const deltaVsMedian = team.pss - median;

        strengthResults.push({
          league_id: leagueId,
          team_id: team.teamId,
          position: pos,
          pss: team.pss,
          rank: currentRank,
          z_score: zScore,
          delta_vs_median: deltaVsMedian,
          updated_at: new Date().toISOString(),
        });
      }
    }

    // Upsert results
    if (strengthResults.length > 0) {
      const { error: upsertError } = await supabase
        .from('team_positional_strengths')
        .upsert(strengthResults, { onConflict: 'league_id,team_id,position' });

      if (upsertError) throw upsertError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        teamsProcessed: teams?.length || 0,
        positionsProcessed: positions.length,
        message: 'Positional strengths computed',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error computing positional strengths:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function calculateMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
