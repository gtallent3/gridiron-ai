import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";

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

// Bench depth to consider in strength calculations
const BENCH_DEPTH: Record<string, number> = {
  RB: 2,
  WR: 2,
  TE: 1,
  QB: 1,
  K: 0,
  DST: 0,
};

// Position-specific weight vectors (heavily emphasize top player, especially QB/TE)
const POSITION_WEIGHTS: Record<string, number[]> = {
  RB: [4.00, 2.50, 1.80, 0.15],  // Top RB heavily weighted (starters + flex)
  WR: [4.00, 2.50, 1.80, 0.15],  // Top WR heavily weighted (starters + flex)
  QB: [6.00, 0.03, 0.0],         // Best QB VERY heavily weighted, backup minimal, 3rd string worthless
  TE: [5.50, 0.10],              // Best TE VERY heavily weighted (single starter position)
  K: [2.00],                     // Best kicker only
  DST: [2.00],                   // Best defense only
};

// FLEX weights for leftover RB/WR/TE (emphasize best FLEX option)
const FLEX_WEIGHTS = [1.50, 0.60];

Deno.serve(async (req) => {
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

    // Fetch player rankings (global data source)
    const { data: playerRankings, error: rankingsError } = await supabase
      .from('player_rankings')
      .select('player_id, player_name, position, team, trade_value');

    if (rankingsError) throw rankingsError;

    console.log(`Loaded ${playerRankings?.length || 0} player rankings`);

    // Fetch canonical players for ID mapping
    const { data: canonicalPlayers, error: canonicalError } = await supabase
      .from('canonical_players')
      .select('id, espn_id, yahoo_id, sleeper_id, player_name, position');

    if (canonicalError) throw canonicalError;

    // Build mapping: canonical_player_id -> ranking
    const rankingMap = new Map<string, any>();
    for (const ranking of playerRankings || []) {
      rankingMap.set(ranking.player_id, ranking);
    }

    // Build mapping: platform_id -> canonical_player_id
    const canonicalMap = new Map<string, string>();
    for (const cp of canonicalPlayers || []) {
      if (cp.espn_id) canonicalMap.set(`espn_${cp.espn_id}`, cp.id);
      if (cp.yahoo_id) canonicalMap.set(`yahoo_${cp.yahoo_id}`, cp.id);
      if (cp.sleeper_id) canonicalMap.set(`sleeper_${cp.sleeper_id}`, cp.id);
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
      // Try to get canonical_player_id from player or lookup via platform ID
      let canonicalId = p.canonical_player_id;
      
      if (!canonicalId && p.player_id) {
        canonicalId = canonicalMap.get(p.player_id);
      }
      
      if (!canonicalId) return null;
      
      const ranking = rankingMap.get(canonicalId);
      return ranking ? { trade_value: ranking.trade_value } : null;
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

    for (const team of teams || []) {
      const roster = (team.roster as any[]) || [];
      const teamMap = new Map<string, number>();
      
      // Build sorted value arrays for each position
      const sortedValues: Record<string, number[]> = {};
      
      for (const pos of positions) {
        const posPlayers = roster
          .filter(p => normPos(p.position) === pos)
          .map(p => {
            const value = getValueForPlayer(p);
            return value ? Number(value.trade_value) || 0 : 0;
          })
          .sort((a, b) => b - a); // descending
        
        sortedValues[pos] = posPlayers;
        
        // Calculate PSS using slot-weighted diminishing returns
        const pss = calculatePSSForPosition(posPlayers, pos);
        teamMap.set(pos, pss);
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
      ].sort((a, b) => b - a); // descending

      // Calculate FLEX PSS using FLEX weights
      let flexPSS = 0;
      const flexTake = Math.min(flexSlots, FLEX_WEIGHTS.length, flexCandidates.length);
      for (let i = 0; i < flexTake; i++) {
        flexPSS += flexCandidates[i] * FLEX_WEIGHTS[i];
      }
      teamMap.set('FLEX', flexPSS);

      teamPSS.set(team.team_id, teamMap);
    }

    // Calculate league-wide stats per position and assign ranks (include FLEX)
    const strengthResults = [];
    const allPositions = [...positions, 'FLEX'];

    for (const pos of allPositions) {
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
