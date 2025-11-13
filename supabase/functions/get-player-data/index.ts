import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

// Helper function to normalize player names for matching
function normalizeName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[.\-'\s]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .trim();
}

// Helper function to normalize positions
function normalizePosition(pos: string): string {
  if (!pos) return '';
  let p = String(pos).toUpperCase().trim();

  // Handle combined roster slots like "RB/WR" or "WR/RB/TE"
  if (p.includes('/')) {
    const parts = p.split('/');
    const primary = parts.find(part => ['QB','RB','WR','TE','K','DEF','DST','D/ST'].includes(part));
    if (primary) p = primary;
  }

  // Map ESPN numeric codes and synonyms to standard positions
  const codeMap: Record<string, string> = {
    '1': 'QB',
    '2': 'RB',
    '3': 'WR',
    '4': 'TE',
    '5': 'K',
    '16': 'D/ST',
  };

  if (codeMap[p]) return codeMap[p];
  if (p === 'DEF' || p === 'DST' || p === 'D/ST') return 'D/ST';

  return p;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const requestSchema = z.object({
  week: z.number().int().min(1).max(18).optional(),
  season: z.number().int().min(2020).max(2030).optional(),
  leagueId: z.string().uuid().optional(),
  playerIds: z.array(z.string()).optional(),
});

interface PlayerStats {
  passing_yards?: number;
  passing_tds?: number;
  passing_attempts?: number;
  passing_completions?: number;
  interceptions?: number;
  passing_2pt_conversions?: number;
  rushing_yards?: number;
  rushing_tds?: number;
  rushing_attempts?: number;
  rushing_2pt_conversions?: number;
  receptions?: number;
  receiving_yards?: number;
  receiving_tds?: number;
  receiving_targets?: number;
  receiving_2pt_conversions?: number;
  fg_made?: number;
  fg_made_0_19?: number;
  fg_made_20_29?: number;
  fg_made_30_39?: number;
  fg_made_40_49?: number;
  fg_made_50_plus?: number;
  xp_made?: number;
  fumbles_lost?: number;
  sacks?: number;
  fumbles_recovered?: number;
  interception_tds?: number;
  fumble_recovery_tds?: number;
  defensive_tds?: number;
  kick_return_tds?: number;
  punt_return_tds?: number;
  safeties?: number;
  blocked_kicks?: number;
  points_allowed?: number;
  yards_allowed?: number;
}

interface ScoringSettings {
  // Passing
  passing_yards?: number;
  passing_tds?: number;
  passing_attempts?: number;
  passing_completions?: number;
  interceptions?: number;
  passing_2pt_conversions?: number;
  
  // Rushing
  rushing_yards?: number;
  rushing_tds?: number;
  rushing_attempts?: number;
  rushing_2pt_conversions?: number;
  
  // Receiving
  receptions?: number;
  receiving_yards?: number;
  receiving_tds?: number;
  receiving_targets?: number;
  receiving_2pt_conversions?: number;
  
  // Kicking
  fg_made?: number;
  fg_missed?: number;
  fg_made_0_19?: number;
  fg_made_20_29?: number;
  fg_made_30_39?: number;
  fg_made_40_49?: number;
  fg_made_50_plus?: number;
  xp_made?: number;
  xp_missed?: number;
  
  // Defense
  sacks?: number;
  fumbles_recovered?: number;
  interception_tds?: number;
  fumble_recovery_tds?: number;
  defensive_tds?: number;
  kick_return_tds?: number;
  punt_return_tds?: number;
  safeties?: number;
  blocked_kicks?: number;
  
  // Misc
  fumbles_lost?: number;
  points_allowed_0?: number;
  points_allowed_1_6?: number;
  points_allowed_7_13?: number;
  points_allowed_14_20?: number;
  points_allowed_21_27?: number;
  points_allowed_28_34?: number;
  points_allowed_35_plus?: number;
  yards_allowed_0_99?: number;
  yards_allowed_100_199?: number;
  yards_allowed_200_299?: number;
  yards_allowed_300_399?: number;
  yards_allowed_400_499?: number;
  yards_allowed_500_plus?: number;
}

// Default PPR scoring settings
const DEFAULT_SCORING: ScoringSettings = {
  passing_yards: 0.04,
  passing_tds: 4,
  interceptions: -2,
  passing_2pt_conversions: 2,
  rushing_yards: 0.1,
  rushing_tds: 6,
  rushing_2pt_conversions: 2,
  receptions: 1, // PPR
  receiving_yards: 0.1,
  receiving_tds: 6,
  receiving_2pt_conversions: 2,
  fg_made_0_19: 3,
  fg_made_20_29: 3,
  fg_made_30_39: 3,
  fg_made_40_49: 4,
  fg_made_50_plus: 5,
  xp_made: 1,
  fumbles_lost: -2,
  sacks: 1,
  fumbles_recovered: 2,
  interception_tds: 6,
  fumble_recovery_tds: 6,
  defensive_tds: 6,
  safeties: 2,
  blocked_kicks: 2,
};

function calculateFantasyPoints(stats: PlayerStats, scoring: ScoringSettings): { total: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let total = 0;

  // Passing
  if (stats.passing_yards) {
    const points = stats.passing_yards * (scoring.passing_yards || 0);
    breakdown.passing_yards = points;
    total += points;
  }
  if (stats.passing_tds) {
    const points = stats.passing_tds * (scoring.passing_tds || 0);
    breakdown.passing_tds = points;
    total += points;
  }
  if (stats.interceptions) {
    const points = stats.interceptions * (scoring.interceptions || 0);
    breakdown.interceptions = points;
    total += points;
  }
  if (stats.passing_2pt_conversions) {
    const points = stats.passing_2pt_conversions * (scoring.passing_2pt_conversions || 0);
    breakdown.passing_2pt_conversions = points;
    total += points;
  }

  // Rushing
  if (stats.rushing_yards) {
    const points = stats.rushing_yards * (scoring.rushing_yards || 0);
    breakdown.rushing_yards = points;
    total += points;
  }
  if (stats.rushing_tds) {
    const points = stats.rushing_tds * (scoring.rushing_tds || 0);
    breakdown.rushing_tds = points;
    total += points;
  }
  if (stats.rushing_2pt_conversions) {
    const points = stats.rushing_2pt_conversions * (scoring.rushing_2pt_conversions || 0);
    breakdown.rushing_2pt_conversions = points;
    total += points;
  }

  // Receiving
  if (stats.receptions) {
    const points = stats.receptions * (scoring.receptions || 0);
    breakdown.receptions = points;
    total += points;
  }
  if (stats.receiving_yards) {
    const points = stats.receiving_yards * (scoring.receiving_yards || 0);
    breakdown.receiving_yards = points;
    total += points;
  }
  if (stats.receiving_tds) {
    const points = stats.receiving_tds * (scoring.receiving_tds || 0);
    breakdown.receiving_tds = points;
    total += points;
  }
  if (stats.receiving_2pt_conversions) {
    const points = stats.receiving_2pt_conversions * (scoring.receiving_2pt_conversions || 0);
    breakdown.receiving_2pt_conversions = points;
    total += points;
  }

  // Kicking
  if (stats.fg_made_0_19) {
    const points = stats.fg_made_0_19 * (scoring.fg_made_0_19 || 0);
    breakdown.fg_made_0_19 = points;
    total += points;
  }
  if (stats.fg_made_20_29) {
    const points = stats.fg_made_20_29 * (scoring.fg_made_20_29 || 0);
    breakdown.fg_made_20_29 = points;
    total += points;
  }
  if (stats.fg_made_30_39) {
    const points = stats.fg_made_30_39 * (scoring.fg_made_30_39 || 0);
    breakdown.fg_made_30_39 = points;
    total += points;
  }
  if (stats.fg_made_40_49) {
    const points = stats.fg_made_40_49 * (scoring.fg_made_40_49 || 0);
    breakdown.fg_made_40_49 = points;
    total += points;
  }
  if (stats.fg_made_50_plus) {
    const points = stats.fg_made_50_plus * (scoring.fg_made_50_plus || 0);
    breakdown.fg_made_50_plus = points;
    total += points;
  }
  if (stats.xp_made) {
    const points = stats.xp_made * (scoring.xp_made || 0);
    breakdown.xp_made = points;
    total += points;
  }

  // Defense/Special Teams
  if (stats.sacks) {
    const points = stats.sacks * (scoring.sacks || 0);
    breakdown.sacks = points;
    total += points;
  }
  if (stats.fumbles_recovered) {
    const points = stats.fumbles_recovered * (scoring.fumbles_recovered || 0);
    breakdown.fumbles_recovered = points;
    total += points;
  }
  if (stats.interception_tds) {
    const points = stats.interception_tds * (scoring.interception_tds || 0);
    breakdown.interception_tds = points;
    total += points;
  }
  if (stats.fumble_recovery_tds) {
    const points = stats.fumble_recovery_tds * (scoring.fumble_recovery_tds || 0);
    breakdown.fumble_recovery_tds = points;
    total += points;
  }
  if (stats.defensive_tds) {
    const points = stats.defensive_tds * (scoring.defensive_tds || 0);
    breakdown.defensive_tds = points;
    total += points;
  }
  if (stats.kick_return_tds) {
    const points = stats.kick_return_tds * (scoring.kick_return_tds || 0);
    breakdown.kick_return_tds = points;
    total += points;
  }
  if (stats.punt_return_tds) {
    const points = stats.punt_return_tds * (scoring.punt_return_tds || 0);
    breakdown.punt_return_tds = points;
    total += points;
  }
  if (stats.safeties) {
    const points = stats.safeties * (scoring.safeties || 0);
    breakdown.safeties = points;
    total += points;
  }
  if (stats.blocked_kicks) {
    const points = stats.blocked_kicks * (scoring.blocked_kicks || 0);
    breakdown.blocked_kicks = points;
    total += points;
  }

  // Misc
  if (stats.fumbles_lost) {
    const points = stats.fumbles_lost * (scoring.fumbles_lost || 0);
    breakdown.fumbles_lost = points;
    total += points;
  }

  // Points allowed (DST)
  if (stats.points_allowed !== undefined) {
    let paPoints = 0;
    if (stats.points_allowed === 0) paPoints = scoring.points_allowed_0 || 10;
    else if (stats.points_allowed <= 6) paPoints = scoring.points_allowed_1_6 || 7;
    else if (stats.points_allowed <= 13) paPoints = scoring.points_allowed_7_13 || 4;
    else if (stats.points_allowed <= 20) paPoints = scoring.points_allowed_14_20 || 1;
    else if (stats.points_allowed <= 27) paPoints = scoring.points_allowed_21_27 || 0;
    else if (stats.points_allowed <= 34) paPoints = scoring.points_allowed_28_34 || -1;
    else paPoints = scoring.points_allowed_35_plus || -4;
    
    breakdown.points_allowed = paPoints;
    total += paPoints;
  }

  // Yards allowed (DST)
  if (stats.yards_allowed !== undefined) {
    let yaPoints = 0;
    if (stats.yards_allowed < 100) yaPoints = scoring.yards_allowed_0_99 || 10;
    else if (stats.yards_allowed < 200) yaPoints = scoring.yards_allowed_100_199 || 7;
    else if (stats.yards_allowed < 300) yaPoints = scoring.yards_allowed_200_299 || 4;
    else if (stats.yards_allowed < 400) yaPoints = scoring.yards_allowed_300_399 || 1;
    else if (stats.yards_allowed < 500) yaPoints = scoring.yards_allowed_400_499 || 0;
    else yaPoints = scoring.yards_allowed_500_plus || -4;
    
    breakdown.yards_allowed = yaPoints;
    total += yaPoints;
  }

  return { total: Math.round(total * 100) / 100, breakdown };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body (support body and query params) and infer season
    const json = await req.json().catch(() => ({}));
    const url = new URL(req.url);
    const now = new Date();
    // NFL season runs Sep-Feb: Sep-Dec = current year, Jan-Aug = previous year
    const inferredSeason = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;

    const rawWeek = json.week ?? url.searchParams.get('week');
    const rawSeason = json.season ?? url.searchParams.get('season') ?? inferredSeason;
    const leagueId = json.leagueId ?? url.searchParams.get('leagueId');
    const playerIds = json.playerIds ?? (url.searchParams.get('playerIds')?.split(',') ?? undefined);

    const weekNum = (rawWeek !== undefined && rawWeek !== null && rawWeek !== '') ? Number(rawWeek) : undefined;
    const seasonNum = Number(rawSeason) || inferredSeason;

    // Validate input parameters
    const validationResult = requestSchema.safeParse({
      week: weekNum,
      season: seasonNum,
      leagueId,
      playerIds,
    });

    if (!validationResult.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid input parameters', details: validationResult.error.issues }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Fetching player data:', { week: weekNum, season: seasonNum, leagueId, playerIds });

    // Get current week to determine if we should use actuals or projections
    const currentWeek = weekNum !== undefined ? weekNum : undefined;

    // Get league scoring settings if leagueId provided
    let scoringSettings = DEFAULT_SCORING;
    if (leagueId) {
      const { data: league } = await supabase
        .from('connected_leagues')
        .select('scoring_settings, scoring_type')
        .eq('id', leagueId)
        .eq('user_id', user.id)
        .single();

      if (league?.scoring_settings) {
        scoringSettings = { ...DEFAULT_SCORING, ...league.scoring_settings };
      } else if (league?.scoring_type === 'standard') {
        scoringSettings = { ...DEFAULT_SCORING, receptions: 0 };
      } else if (league?.scoring_type === 'half_ppr') {
        scoringSettings = { ...DEFAULT_SCORING, receptions: 0.5 };
      }
    }

    // Use player_pool_v2 as single source of truth
    let poolQuery = supabase
      .from('player_pool_v2')
      .select('*')
      .eq('season', seasonNum);

    if (typeof weekNum === 'number' && !Number.isNaN(weekNum)) {
      poolQuery = poolQuery.eq('week', weekNum);
    }

    const { data: poolData, error: poolError } = await poolQuery;

    if (poolError) {
      console.error('Error fetching from player_pool_v2:', poolError);
    }

    // Filter results to match requested player roster by name+position
    let poolDataFinal = poolData || [];

    if (playerIds && playerIds.length > 0) {
      // Build a set of normalized name:position keys from the roster
      const rosterKeys = new Set<string>();
      
      // Get roster player info to build keys
      const variants = new Set<string>();
      for (const id of playerIds) {
        if (!id) continue;
        variants.add(String(id));
        const m = String(id).match(/^espn_(\-?\d+)$/);
        if (m) variants.add(m[1]);
        const n = String(id).match(/^\-?\d+$/);
        if (n) variants.add(`espn_${id}`);
      }

      const idsArr = Array.from(variants);
      const { data: rosterPlayers } = await supabase
        .from('roster_snapshots')
        .select('player_name, position')
        .eq('league_id', leagueId || '')
        .in('player_id', idsArr);

      if (rosterPlayers && rosterPlayers.length > 0) {
        for (const rp of rosterPlayers) {
          const key = `${normalizeName(rp.player_name)}:${normalizePosition(rp.position)}`;
          rosterKeys.add(key);
        }
      }

      // Filter pool data to only include roster players
      if (rosterKeys.size > 0) {
        poolDataFinal = (poolDataFinal as any[]).filter((p: any) => {
          const key = `${normalizeName(p.player_name)}:${normalizePosition(p.position)}`;
          return rosterKeys.has(key);
        });
      }
    }
    
    // Process player_pool_v2 data
    const playerDataMap = new Map<string, any>();
    
    if (poolDataFinal) {
      for (const pool of poolDataFinal as any[]) {
        const normalizedName = normalizeName(pool.player_name);
        const normalizedPos = normalizePosition(pool.position);
        const key = `${normalizedName}:${normalizedPos}:${pool.week}`;
        
        // Extract raw stats from player_pool_v2 - include ALL stat fields
        const normalizedStats: PlayerStats = {
          passing_yards: Number(pool.passing_yards) || 0,
          passing_tds: Number(pool.passing_tds) || 0,
          passing_attempts: Number(pool.passing_attempts) || 0,
          passing_completions: Number(pool.passing_completions) || 0,
          interceptions: Number(pool.passing_ints) || 0,
          passing_2pt_conversions: Number(pool.passing_2pt_conversions) || 0,
          rushing_yards: Number(pool.rushing_yards) || 0,
          rushing_tds: Number(pool.rushing_tds) || 0,
          rushing_attempts: Number(pool.rushing_attempts) || 0,
          rushing_2pt_conversions: Number(pool.rushing_2pt_conversions) || 0,
          receptions: Number(pool.receptions) || 0,
          receiving_yards: Number(pool.receiving_yards) || 0,
          receiving_tds: Number(pool.receiving_tds) || 0,
          receiving_targets: Number(pool.receiving_targets) || 0,
          receiving_2pt_conversions: Number(pool.receiving_2pt_conversions) || 0,
          fumbles_lost: Number(pool.fumbles_lost) || 0,
          fg_made_0_19: Number(pool.fg_made_0_19) || 0,
          fg_made_20_29: Number(pool.fg_made_20_29) || 0,
          fg_made_30_39: Number(pool.fg_made_30_39) || 0,
          fg_made_40_49: Number(pool.fg_made_40_49) || 0,
          fg_made_50_plus: Number(pool.fg_made_50_plus) || 0,
          xp_made: Number(pool.xp_made) || 0,
          sacks: Number(pool.sacks) || 0,
          fumbles_recovered: Number(pool.fumbles_recovered) || 0,
          interception_tds: Number(pool.interception_tds) || 0,
          fumble_recovery_tds: Number(pool.fumble_recovery_tds) || 0,
          defensive_tds: Number(pool.defensive_tds) || 0,
          kick_return_tds: Number(pool.kick_return_tds) || 0,
          punt_return_tds: Number(pool.punt_return_tds) || 0,
          safeties: Number(pool.safeties) || 0,
          blocked_kicks: Number(pool.blocked_kicks) || 0,
          points_allowed: pool.points_allowed !== null ? Number(pool.points_allowed) : undefined,
          yards_allowed: pool.yards_allowed !== null ? Number(pool.yards_allowed) : undefined,
        };
        
        // Calculate fantasy points from raw stats using league scoring
        const { total: calculatedPoints, breakdown } = calculateFantasyPoints(normalizedStats, scoringSettings);
        
        // Determine if this is actual or projected data
        const hasActual = pool.actual_fp !== null && pool.actual_fp !== undefined;
        const sourceType = hasActual ? 'actual' : 'projected';
        
        playerDataMap.set(key, {
          ...normalizedStats,
          player_id: pool.canonical_player_id || pool.player_name,
          player_name: pool.player_name,
          team: pool.team,
          position: normalizedPos,
          week: pool.week,
          season: pool.season,
          opponent: pool.opponent,
          source: pool.source || 'player_pool_v2',
          source_type: sourceType,
          fantasy_points: calculatedPoints,
          points_breakdown: breakdown,
          projected_fp: hasActual ? undefined : calculatedPoints,
          actual_fp: hasActual ? calculatedPoints : undefined,
          composite_fp: pool.composite_fp,
          updated_at: pool.updated_at,
        });
      }
    }
    
    const stats: any[] = Array.from(playerDataMap.values());

    console.log(`Found ${stats?.length || 0} stat records from player_pool_v2 for week ${weekNum}, season ${seasonNum}`);

    // Calculate fantasy points for each player
    const playersWithPoints = stats.map(player => {
      // Stats are already normalized in the correct format
      const playerStats = player as PlayerStats;
      
      // Only apply defensive scoring to DST positions
      const isDST = player.position === 'D/ST' || player.position === 'DEF' || player.position === 'DST' || player.position === '16';
      const adjustedStats = { ...playerStats };
      
      // Zero out defensive stats for non-DST players to prevent incorrect scoring
      if (!isDST) {
        adjustedStats.sacks = 0;
        adjustedStats.fumbles_recovered = 0;
        adjustedStats.interception_tds = 0;
        adjustedStats.fumble_recovery_tds = 0;
        adjustedStats.defensive_tds = 0;
        adjustedStats.kick_return_tds = 0;
        adjustedStats.punt_return_tds = 0;
        adjustedStats.safeties = 0;
        adjustedStats.blocked_kicks = 0;
        adjustedStats.points_allowed = undefined;
        adjustedStats.yards_allowed = undefined;
      }
      
      const { total, breakdown } = calculateFantasyPoints(adjustedStats, scoringSettings);
      
      // Prefer ESPN projected_fp or sum of __applied_breakdown for projections
      const isKicker = player.position === 'K' || player.position === '5';
      let kickerProjected: number | undefined = undefined;
      if (isKicker && player.source_type !== 'actual') {
        const pf = (player as any).projected_fp ?? (playerStats as any).projected_fp;
        if (typeof pf === 'number' && !Number.isNaN(pf)) {
          kickerProjected = pf;
        } else {
          const breakdownRaw = (player as any).__applied_breakdown ?? (playerStats as any).__applied_breakdown;
          if (breakdownRaw && typeof breakdownRaw === 'object') {
            kickerProjected = Object.values(breakdownRaw as Record<string, number | unknown>)
              .reduce((acc: number, v: unknown) => acc + (typeof v === 'number' ? v : 0), 0);
          }
        }
      }

      const isDefense = isDST;
      let defenseProjected: number | undefined = undefined;
      if (isDefense && player.source_type !== 'actual') {
        const pf = (player as any).projected_fp ?? (playerStats as any).projected_fp;
        if (typeof pf === 'number' && !Number.isNaN(pf)) {
          defenseProjected = pf;
        } else {
          const breakdownRaw = (player as any).__applied_breakdown ?? (playerStats as any).__applied_breakdown;
          if (breakdownRaw && typeof breakdownRaw === 'object') {
            defenseProjected = Object.values(breakdownRaw as Record<string, number | unknown>)
              .reduce((acc: number, v: unknown) => acc + (typeof v === 'number' ? v : 0), 0);
          }
        }
      }

      const chosenProjected = typeof kickerProjected === 'number' ? kickerProjected
        : (typeof defenseProjected === 'number' ? defenseProjected : undefined);

      const finalTotal = typeof chosenProjected === 'number' ? Math.round(chosenProjected * 100) / 100 : total;
      const projectedFpForStats = typeof chosenProjected === 'number'
        ? chosenProjected
        : (typeof (playerStats as any)?.projected_fp === 'number' ? (playerStats as any).projected_fp : undefined);
      
      return {
        player_id: player.player_id,
        player_name: player.player_name,
        team: player.team,
        position: player.position,
        week: player.week,
        season: player.season,
        source_type: player.source_type,
        provenance: player.source_type === 'actual' ? 'nfl_fantasy_points' : 'espn_projection',
        projection_in_use: player.source_type !== 'actual',
        // Surface projection helpers for UI
        projected_fp: typeof chosenProjected === 'number' ? Math.round(chosenProjected * 100) / 100 : (player as any).projected_fp,
        __applied_breakdown: (player as any).__applied_breakdown,
        stats: isDST ? {
          sacks: playerStats.sacks,
          interceptions: playerStats.interceptions,
          fumbles_recovered: playerStats.fumbles_recovered,
          interception_tds: playerStats.interception_tds,
          fumble_recovery_tds: playerStats.fumble_recovery_tds,
          defensive_tds: playerStats.defensive_tds,
          kick_return_tds: playerStats.kick_return_tds,
          punt_return_tds: playerStats.punt_return_tds,
          safeties: playerStats.safeties,
          blocked_kicks: playerStats.blocked_kicks,
          points_allowed: playerStats.points_allowed,
          yards_allowed: playerStats.yards_allowed,
        } : {
          passing_yards: playerStats.passing_yards,
          passing_tds: playerStats.passing_tds,
          interceptions: playerStats.interceptions,
          passing_2pt_conversions: playerStats.passing_2pt_conversions,
          rushing_yards: playerStats.rushing_yards,
          rushing_tds: playerStats.rushing_tds,
          rushing_2pt_conversions: playerStats.rushing_2pt_conversions,
          receptions: playerStats.receptions,
          receiving_yards: playerStats.receiving_yards,
          receiving_tds: playerStats.receiving_tds,
          receiving_2pt_conversions: playerStats.receiving_2pt_conversions,
          fumbles_lost: playerStats.fumbles_lost,
          // Include projected_fp so the UI can prioritize it for kickers/others
          projected_fp: projectedFpForStats,
        },
        fantasy_points: finalTotal,
        points_breakdown: breakdown,
        source: player.source || 'espn',
        last_updated: player.updated_at,
      };
    });

    return new Response(
      JSON.stringify({
        players: playersWithPoints,
        scoring_settings: scoringSettings,
        total_players: playersWithPoints.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in get-player-data:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});