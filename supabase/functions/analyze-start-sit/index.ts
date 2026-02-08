import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


const requestSchema = z.object({
  player1Name: z.string().min(2).max(100),
  player2Name: z.string().min(2).max(100),
  week: z.number().int().min(1).max(18),
  season: z.number().int().min(2024).max(2026),
});

// Standard PPR scoring
const SCORING = {
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -2,
  rush_yd: 0.1,
  rush_td: 6,
  rec: 1, // PPR
  rec_yd: 0.1,
  rec_td: 6,
};

function calculateFantasyPoints(player: any): number {
  let total = 0;
  
  if (player.pass_yd) total += player.pass_yd * SCORING.pass_yd;
  if (player.pass_td) total += player.pass_td * SCORING.pass_td;
  if (player.pass_int) total += player.pass_int * SCORING.pass_int;
  if (player.rush_yd) total += player.rush_yd * SCORING.rush_yd;
  if (player.rush_td) total += player.rush_td * SCORING.rush_td;
  if (player.rec) total += player.rec * SCORING.rec;
  if (player.rec_yd) total += player.rec_yd * SCORING.rec_yd;
  if (player.rec_td) total += player.rec_td * SCORING.rec_td;
  
  return Math.round(total * 10) / 10; // Round to 1 decimal
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
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

    // Search for both players in sleeper_projections with fuzzy matching
    const { data: player1Data, error: p1Error } = await supabase
      .from('sleeper_projections')
      .select('*')
      .ilike('player_name', `%${player1Name}%`)
      .eq('week', week)
      .eq('season', season)
      .order('pts_ppr', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    const { data: player2Data, error: p2Error } = await supabase
      .from('sleeper_projections')
      .select('*')
      .ilike('player_name', `%${player2Name}%`)
      .eq('week', week)
      .eq('season', season)
      .order('pts_ppr', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (p1Error) {
      console.error('Error fetching player 1:', p1Error);
    }
    if (p2Error) {
      console.error('Error fetching player 2:', p2Error);
    }

    console.log('Player 1 data:', player1Data);
    console.log('Player 2 data:', player2Data);

    // Check eligibility for each player
    const checkEligibility = (player: any | null, searchName: string) => {
      if (!player) {
        return {
          eligible: false,
          reason: `Player not found: "${searchName}"`,
          player: null,
          projection: 0,
        };
      }

      // Check bye week
      if (player.bye_week === true) {
        return {
          eligible: false,
          reason: `${player.player_name} is on a BYE week`,
          player,
          projection: 0,
        };
      }

      // Use pts_ppr if available, otherwise calculate from raw stats
      const projection = player.pts_ppr ?? calculateFantasyPoints(player);

      // Player is eligible
      return {
        eligible: true,
        reason: null,
        player,
        projection,
      };
    };

    const player1Check = checkEligibility(player1Data, player1Name);
    const player2Check = checkEligibility(player2Data, player2Name);

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
          injury_status: null,
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
          injury_status: null,
          eligible: true,
        } : {
          name: player2Name,
          eligible: false,
          ineligibilityReason: player2Check.reason,
        },
        lastUpdated: new Date().toISOString(),
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
