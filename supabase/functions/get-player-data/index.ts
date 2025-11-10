import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

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

    // Prepare ID mappings using normalized_players so roster ESPN IDs match Sleeper IDs
    let actualIdList: string[] | undefined;
    let sleeperIdList: string[] | undefined;
    let namesList: string[] | undefined;

    if (playerIds && playerIds.length > 0) {
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
      const [npByEspn, npByPid] = await Promise.all([
        supabase.from('normalized_players').select('player_id, player_name, position, team, espn_id, sleeper_id').in('espn_id', idsArr),
        supabase.from('normalized_players').select('player_id, player_name, position, team, espn_id, sleeper_id').in('player_id', idsArr),
      ]);

      const normRows = [
        ...(npByEspn.data || []),
        ...(npByPid.data || []),
      ];

      const actualSet = new Set<string>();
      const sleeperSet = new Set<string>();
      const nameSet = new Set<string>();

      for (const r of normRows) {
        if (r.espn_id) actualSet.add(String(r.espn_id));
        if (r.player_id) actualSet.add(String(r.player_id));
        if (r.sleeper_id) sleeperSet.add(String(r.sleeper_id));
        if (r.player_name) nameSet.add(String(r.player_name));
      }

      // Fallback: include original variants so we don't over-filter
      for (const v of idsArr) {
        actualSet.add(v);
        sleeperSet.add(v);
      }

      actualIdList = Array.from(actualSet);
      sleeperIdList = Array.from(sleeperSet);
      namesList = Array.from(nameSet);
    }

    // Build query for actual stats from nfl_fantasy_points
    let actualsQuery = supabase
      .from('nfl_fantasy_points')
      .select('*')
      .eq('season', seasonNum);

    if (typeof weekNum === 'number' && !Number.isNaN(weekNum)) {
      actualsQuery = actualsQuery.eq('week', weekNum);
    }

    if (actualIdList && actualIdList.length > 0) {
      actualsQuery = actualsQuery.in('player_id', actualIdList);
    }

    // Build query for projections from sleeper_projections
    let projectionsQuery = supabase
      .from('sleeper_projections')
      .select('*')
      .eq('season', seasonNum);

    if (typeof weekNum === 'number' && !Number.isNaN(weekNum)) {
      projectionsQuery = projectionsQuery.eq('week', weekNum);
    }

    if (sleeperIdList && sleeperIdList.length > 0) {
      projectionsQuery = projectionsQuery.in('player_id', sleeperIdList);
    }

    // Fetch both actuals and projections
    const [{ data: actuals, error: actualsError }, { data: projections, error: projectionsError }] = 
      await Promise.all([
        actualsQuery,
        projectionsQuery
      ]);

    if (actualsError) {
      console.error('Error fetching actuals from nfl_fantasy_points:', actualsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch player stats' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (projectionsError) {
      console.error('Error fetching projections from sleeper_projections:', projectionsError);
    }

    // Fallback enrichment by player_name if ID-mapped results look too small
    let actualsFinal = actuals || [];
    let projectionsFinal = projections || [];

    if ((projectionsFinal.length < (playerIds?.length || 0)) && namesList && namesList.length > 0) {
      const { data: projByName } = await supabase
        .from('sleeper_projections')
        .select('*')
        .eq('season', seasonNum)
        .eq('week', weekNum)
        .in('player_name', namesList);
      if (projByName && projByName.length > 0) {
        const seen = new Set(projectionsFinal.map((p: any) => `${p.player_id}_${p.week}`));
        for (const p of projByName) {
          const key = `${p.player_id}_${p.week}`;
          if (!seen.has(key)) projectionsFinal.push(p);
        }
      }
    }

    if ((actualsFinal.length < (playerIds?.length || 0)) && namesList && namesList.length > 0) {
      const { data: actByName } = await supabase
        .from('nfl_fantasy_points')
        .select('*')
        .eq('season', seasonNum)
        .eq('week', weekNum)
        .in('player_name', namesList);
      if (actByName && actByName.length > 0) {
        const seenA = new Set(actualsFinal.map((a: any) => `${a.player_id}_${a.week}`));
        for (const a of actByName) {
          const key = `${a.player_id}_${a.week}`;
          if (!seenA.has(key)) actualsFinal.push(a);
        }
      }
    }
    // Implement actuals-first selection logic
    const playerDataMap = new Map<string, any>();
    
    // First, add all projections from sleeper_projections
    if (projectionsFinal) {
      for (const proj of projectionsFinal as any[]) {
        const key = `${proj.player_id}_${proj.week}`;
        
        // Map sleeper_projections columns to standard format
        const normalizedStats: PlayerStats = {
          passing_yards: Number(proj.pass_yd) || 0,
          passing_tds: Number(proj.pass_td) || 0,
          interceptions: Number(proj.pass_int) || 0,
          rushing_yards: Number(proj.rush_yd) || 0,
          rushing_tds: Number(proj.rush_td) || 0,
          receptions: Number(proj.rec) || 0,
          receiving_yards: Number(proj.rec_yd) || 0,
          receiving_tds: Number(proj.rec_td) || 0,
        };
        
        // Select precomputed projected fantasy points matching league scoring
        const leagueProjected = (scoringSettings.receptions === 0
          ? Number(proj.pts_std)
          : (scoringSettings.receptions === 0.5 ? Number(proj.pts_half_ppr) : Number(proj.pts_ppr)));
        
        playerDataMap.set(key, {
          ...normalizedStats,
          player_id: proj.player_id,
          player_name: proj.player_name,
          team: proj.team,
          position: proj.position,
          week: proj.week,
          season: proj.season,
          opponent: proj.opponent,
          source: 'sleeper_projection',
          source_type: 'projected',
          projected_fp: !Number.isNaN(leagueProjected) ? leagueProjected : undefined,
          updated_at: proj.updated_at,
        });
      }
    }
    
    // Then, override with actuals from nfl_fantasy_points where available (actuals-first)
    if (actualsFinal) {
      for (const actual of actualsFinal as any[]) {
        const key = `${actual.player_id}_${actual.week}`;
        
        // Map nfl_fantasy_points columns to standard format
        const normalizedStats: PlayerStats = {
          passing_yards: Number(actual.passing_yards) || 0,
          passing_tds: Number(actual.passing_tds) || 0,
          interceptions: Number(actual.passing_ints) || 0,
          rushing_yards: Number(actual.rushing_yards) || 0,
          rushing_tds: Number(actual.rushing_tds) || 0,
          receptions: Number(actual.receptions) || 0,
          receiving_yards: Number(actual.receiving_yards) || 0,
          receiving_tds: Number(actual.receiving_tds) || 0,
        };
        
        playerDataMap.set(key, {
          ...normalizedStats,
          player_id: actual.player_id,
          player_name: actual.player_name,
          team: actual.team,
          position: actual.position,
          week: actual.week,
          season: actual.season,
          opponent: actual.opponent,
          source: 'nfl_fantasy_points',
          source_type: 'actual',
          updated_at: actual.updated_at,
        });
      }
    }

    const stats: any[] = Array.from(playerDataMap.values());

    console.log(`Found ${stats?.length || 0} stat records (${actualsFinal?.length || 0} actuals, ${projectionsFinal?.length || 0} projections) for week ${weekNum}, season ${seasonNum}`);

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