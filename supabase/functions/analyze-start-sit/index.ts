import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
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

interface PlayerProjection {
  player_id: string;
  player_name: string;
  team: string | null;
  position: string;
  week: number;
  season: number;
  ppg_projection: number;
  is_bye_week: boolean;
  injury_status: string | null;
  injury_duration_weeks: number;
  last_updated_at: string;
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

    // Search for both players in player_valuations with fuzzy matching
    const { data: player1Data, error: p1Error } = await supabase
      .from('player_valuations')
      .select('*')
      .ilike('player_name', `%${player1Name}%`)
      .eq('week', week)
      .eq('season', season)
      .order('player_value', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: player2Data, error: p2Error } = await supabase
      .from('player_valuations')
      .select('*')
      .ilike('player_name', `%${player2Name}%`)
      .eq('week', week)
      .eq('season', season)
      .order('player_value', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (p1Error) {
      console.error('Error fetching player 1:', p1Error);
    }
    if (p2Error) {
      console.error('Error fetching player 2:', p2Error);
    }

    // Check eligibility for each player
    const checkEligibility = (player: PlayerProjection | null, searchName: string) => {
      if (!player) {
        return {
          eligible: false,
          reason: `Player not found: "${searchName}"`,
          player: null,
        };
      }

      // Check bye week
      if (player.is_bye_week) {
        return {
          eligible: false,
          reason: `${player.player_name} is on a BYE week`,
          player,
        };
      }

      // Check injury status
      const injuryStatuses = ['Out', 'IR', 'Suspended', 'Doubtful'];
      if (player.injury_status && injuryStatuses.includes(player.injury_status)) {
        return {
          eligible: false,
          reason: `${player.player_name} is ${player.injury_status}`,
          player,
        };
      }

      // Check injury duration (multi-week injuries)
      if (player.injury_duration_weeks && player.injury_duration_weeks > 0) {
        return {
          eligible: false,
          reason: `${player.player_name} is injured (${player.injury_duration_weeks} weeks)`,
          player,
        };
      }

      // Player is eligible
      return {
        eligible: true,
        reason: null,
        player,
      };
    };

    const player1Check = checkEligibility(player1Data as PlayerProjection | null, player1Name);
    const player2Check = checkEligibility(player2Data as PlayerProjection | null, player2Name);

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
      const p1Projection = player1Check.player!.ppg_projection;
      const p2Projection = player2Check.player!.ppg_projection;
      const diff = Math.abs(p1Projection - p2Projection);
      
      if (p1Projection > p2Projection) {
        recommendation = `Start ${player1Check.player!.player_name}`;
        reasoning = `Higher projected points (${p1Projection.toFixed(1)} vs ${p2Projection.toFixed(1)})`;
        // Confidence based on difference (more difference = more confident)
        confidence = Math.min(Math.round(50 + (diff / p2Projection) * 100), 95);
      } else if (p2Projection > p1Projection) {
        recommendation = `Start ${player2Check.player!.player_name}`;
        reasoning = `Higher projected points (${p2Projection.toFixed(1)} vs ${p1Projection.toFixed(1)})`;
        confidence = Math.min(Math.round(50 + (diff / p1Projection) * 100), 95);
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
          projection: player1Check.player!.ppg_projection,
          injury_status: player1Check.player!.injury_status,
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
          projection: player2Check.player!.ppg_projection,
          injury_status: player2Check.player!.injury_status,
          eligible: true,
        } : {
          name: player2Name,
          eligible: false,
          ineligibilityReason: player2Check.reason,
        },
        lastUpdated: player1Check.player?.last_updated_at || player2Check.player?.last_updated_at || new Date().toISOString(),
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
