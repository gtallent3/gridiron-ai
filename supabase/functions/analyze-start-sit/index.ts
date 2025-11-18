import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const requestSchema = z.object({
  player1Name: z.string().min(2).max(100),
  player2Name: z.string().min(2).max(100),
  week: z.number().int().min(1).max(18).optional(),
  season: z.number().int().min(2024).max(2026).optional(),
});

interface PlayerStats {
  passing_yards?: number;
  passing_tds?: number;
  interceptions?: number;
  rushing_yards?: number;
  rushing_tds?: number;
  receptions?: number;
  receiving_yards?: number;
  receiving_tds?: number;
  fg_made?: number;
  fg_made_0_19?: number;
  fg_made_20_29?: number;
  fg_made_30_39?: number;
  fg_made_40_49?: number;
  fg_made_50_plus?: number;
  xp_made?: number;
  fumbles_lost?: number;
  passing_2pt_conversions?: number;
  rushing_2pt_conversions?: number;
  receiving_2pt_conversions?: number;
}

interface StatusFlags {
  is_bye?: boolean;
  injury_status?: string;
  injury_duration_weeks?: number;
}

interface ProjectedPlayerStat {
  player_id: string;
  player_name: string;
  team: string | null;
  position: string;
  week: number;
  season: number;
  stats: PlayerStats;
  status_flags: StatusFlags;
  confidence: number;
  last_updated: string;
}

// Standard PPR scoring
const SCORING = {
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
};

function calculateFantasyPoints(stats: PlayerStats): number {
  let total = 0;
  
  if (stats.passing_yards) total += stats.passing_yards * SCORING.passing_yards;
  if (stats.passing_tds) total += stats.passing_tds * SCORING.passing_tds;
  if (stats.interceptions) total += stats.interceptions * SCORING.interceptions;
  if (stats.passing_2pt_conversions) total += stats.passing_2pt_conversions * SCORING.passing_2pt_conversions;
  
  if (stats.rushing_yards) total += stats.rushing_yards * SCORING.rushing_yards;
  if (stats.rushing_tds) total += stats.rushing_tds * SCORING.rushing_tds;
  if (stats.rushing_2pt_conversions) total += stats.rushing_2pt_conversions * SCORING.rushing_2pt_conversions;
  
  if (stats.receptions) total += stats.receptions * SCORING.receptions;
  if (stats.receiving_yards) total += stats.receiving_yards * SCORING.receiving_yards;
  if (stats.receiving_tds) total += stats.receiving_tds * SCORING.receiving_tds;
  if (stats.receiving_2pt_conversions) total += stats.receiving_2pt_conversions * SCORING.receiving_2pt_conversions;
  
  if (stats.fg_made_0_19) total += stats.fg_made_0_19 * SCORING.fg_made_0_19;
  if (stats.fg_made_20_29) total += stats.fg_made_20_29 * SCORING.fg_made_20_29;
  if (stats.fg_made_30_39) total += stats.fg_made_30_39 * SCORING.fg_made_30_39;
  if (stats.fg_made_40_49) total += stats.fg_made_40_49 * SCORING.fg_made_40_49;
  if (stats.fg_made_50_plus) total += stats.fg_made_50_plus * SCORING.fg_made_50_plus;
  if (stats.xp_made) total += stats.xp_made * SCORING.xp_made;
  
  if (stats.fumbles_lost) total += stats.fumbles_lost * SCORING.fumbles_lost;
  
  return Math.round(total * 10) / 10; // Round to 1 decimal
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse and validate request
    const body = await req.json();
    const { player1Name, player2Name, week, season } = requestSchema.parse(body);

    console.log(`Analyzing start/sit: ${player1Name} vs ${player2Name} for week ${week}, season ${season}`);

    // Search for both players in projected_player_stats with fuzzy matching
    const { data: player1Data, error: p1Error } = await supabase
      .from('projected_player_stats')
      .select('*')
      .ilike('player_name', `%${player1Name}%`)
      .eq('week', week)
      .eq('season', season)
      .order('confidence', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: player2Data, error: p2Error } = await supabase
      .from('projected_player_stats')
      .select('*')
      .ilike('player_name', `%${player2Name}%`)
      .eq('week', week)
      .eq('season', season)
      .order('confidence', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (p1Error) {
      console.error('Error fetching player 1:', p1Error);
    }
    if (p2Error) {
      console.error('Error fetching player 2:', p2Error);
    }

    // Check eligibility for each player
    const checkEligibility = (player: ProjectedPlayerStat | null, searchName: string) => {
      if (!player) {
        return {
          eligible: false,
          reason: `Player not found: "${searchName}"`,
          player: null,
          projection: 0,
        };
      }

      const statusFlags = player.status_flags || {};

      // Check bye week
      if (statusFlags.is_bye) {
        return {
          eligible: false,
          reason: `${player.player_name} is on a BYE week`,
          player,
          projection: 0,
        };
      }

      // Check injury status
      const injuryStatuses = ['Out', 'IR', 'Suspended', 'Doubtful'];
      if (statusFlags.injury_status && injuryStatuses.includes(statusFlags.injury_status)) {
        return {
          eligible: false,
          reason: `${player.player_name} is ${statusFlags.injury_status}`,
          player,
          projection: 0,
        };
      }

      // Check injury duration (multi-week injuries)
      if (statusFlags.injury_duration_weeks && statusFlags.injury_duration_weeks > 0) {
        return {
          eligible: false,
          reason: `${player.player_name} is injured (${statusFlags.injury_duration_weeks} weeks)`,
          player,
          projection: 0,
        };
      }

      // Calculate fantasy points projection
      const projection = calculateFantasyPoints(player.stats || {});

      // Player is eligible
      return {
        eligible: true,
        reason: null,
        player,
        projection,
      };
    };

    const player1Check = checkEligibility(player1Data as ProjectedPlayerStat | null, player1Name);
    const player2Check = checkEligibility(player2Data as ProjectedPlayerStat | null, player2Name);

    // Determine recommendation based on eligibility
    let recommendation: string;
    let reasoning: string;
    let confidence: number;

    if (!player1Check.eligible && !player2Check.eligible) {
      // Both players ineligible
      recommendation = 'No valid comparison';
      reasoning = `Both players are unavailable: ${player1Check.reason} and ${player2Check.reason}`;
      confidence = 0;
    } else if (!player1Check.eligible) {
      // Only player 1 ineligible
      recommendation = `Start ${player2Check.player?.player_name || player2Name}`;
      reasoning = `${player1Check.reason}. ${player2Check.player?.player_name} is your only eligible option.`;
      confidence = 100;
    } else if (!player2Check.eligible) {
      // Only player 2 ineligible
      recommendation = `Start ${player1Check.player?.player_name || player1Name}`;
      reasoning = `${player2Check.reason}. ${player1Check.player?.player_name} is your only eligible option.`;
      confidence = 100;
    } else {
      // Both players eligible - compare projections
      const p1Projection = player1Check.projection;
      const p2Projection = player2Check.projection;
      const diff = Math.abs(p1Projection - p2Projection);
      
      if (p1Projection > p2Projection) {
        recommendation = `Start ${player1Check.player!.player_name}`;
        reasoning = `Higher projected points (${p1Projection.toFixed(1)} vs ${p2Projection.toFixed(1)})`;
        // Confidence based on difference (more difference = more confident)
        confidence = Math.min(Math.round(50 + (diff / Math.max(p2Projection, 1)) * 100), 95);
      } else if (p2Projection > p1Projection) {
        recommendation = `Start ${player2Check.player!.player_name}`;
        reasoning = `Higher projected points (${p2Projection.toFixed(1)} vs ${p1Projection.toFixed(1)})`;
        confidence = Math.min(Math.round(50 + (diff / Math.max(p1Projection, 1)) * 100), 95);
      } else {
        recommendation = 'Toss-up';
        reasoning = `Both players have identical projections (${p1Projection.toFixed(1)} pts)`;
        confidence = 50;
      }
    }

    // Fetch all projections for the given week/season (for richer UI context)
    const { data: allWeekProjections, error: allProjError } = await supabase
      .from('projected_player_stats')
      .select('player_id, player_name, team, position, week, season, projected_fp, status_flags, confidence')
      .eq('week', week)
      .eq('season', season)
      .order('projected_fp', { ascending: false, nullsFirst: false })
      .limit(2000);

    if (allProjError) {
      console.error('Error fetching all projections:', allProjError);
    }

    // Return analysis
    return new Response(
      JSON.stringify({
        success: true,
        week,
        season,
        recommendation,
        reasoning,
        confidence,
        player1: player1Check.eligible ? {
          name: player1Check.player!.player_name,
          team: player1Check.player!.team,
          position: player1Check.player!.position,
          projection: player1Check.projection,
          injury_status: player1Check.player!.status_flags?.injury_status || null,
          eligible: true,
        } : {
          name: player1Name,
          eligible: false,
          ineligibilityReason: player1Check.reason,
        },
        player2: player2Check.eligible ? {
          name: player2Check.player!.player_name,
          team: player2Check.player!.team,
          position: player2Check.player!.position,
          projection: player2Check.projection,
          injury_status: player2Check.player!.status_flags?.injury_status || null,
          eligible: true,
        } : {
          name: player2Name,
          eligible: false,
          ineligibilityReason: player2Check.reason,
        },
        allProjections: allWeekProjections || [],
        lastUpdated: player1Check.player?.last_updated || player2Check.player?.last_updated || new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in analyze-start-sit:', error);
    
    if (error instanceof z.ZodError) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid request parameters',
          details: error.errors,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
