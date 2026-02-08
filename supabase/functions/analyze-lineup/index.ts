import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";
import { getCorsHeaders } from "../_shared/cors.ts";


interface Player {
  id: string;
  name: string;
  position: string;
  team: string;
  projected: number;
  actualPoints?: number;
  opponent?: string;
  opponent_def_rank?: number;
  is_bye_week?: boolean;
  injury_status?: string | null;
}

interface Recommendation {
  benchPlayer: Player;
  starterPlayer: Player;
  reasoning: string;
  projectedGain: number;
  winProbabilityChange: number;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { starters, bench, week, season, leagueId } = await req.json();

    if (!starters || !bench || !Array.isArray(starters) || !Array.isArray(bench)) {
      throw new Error('Invalid lineup data provided');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    console.log('Analyzing lineup:', { 
      startersCount: starters.length, 
      benchCount: bench.length,
      week,
      season 
    });

    // Fetch defensive rankings for matchup analysis
    const { data: defRankings } = await supabase
      .from('defensive_rankings')
      .select('team, position, rank, avg_points_allowed')
      .eq('week', week || 1)
      .eq('season', season || 2025);

    console.log('Defensive rankings loaded:', defRankings?.length || 0);

    // Build context for AI analysis
    const lineupContext = {
      starters: starters.map((p: Player) => ({
        name: p.name,
        position: p.position,
        team: p.team,
        projected: p.projected,
        opponent: p.opponent,
        opponentDefRank: p.opponent_def_rank,
        isByeWeek: p.is_bye_week,
        injuryStatus: p.injury_status,
      })),
      bench: bench.map((p: Player) => ({
        name: p.name,
        position: p.position,
        team: p.team,
        projected: p.projected,
        opponent: p.opponent,
        opponentDefRank: p.opponent_def_rank,
        isByeWeek: p.is_bye_week,
        injuryStatus: p.injury_status,
      })),
      defensiveRankings: defRankings || [],
    };

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    // Call Lovable AI for analysis
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `You are an expert fantasy football analyst. Analyze the provided lineup and identify start/sit recommendations.

CRITICAL RULE: NEVER recommend starting a bench player who is projected more than 2 points LOWER than the current starter, regardless of matchup advantages. The projected point difference must not exceed 2 points in favor of keeping the current starter.

DEFENSIVE RANKING INTERPRETATION (CRITICAL - READ CAREFULLY):
- Ranking 1 = TOUGHEST/BEST defense (HARDEST matchup for offense)
- Ranking 32 = EASIEST/WORST defense (BEST matchup for offense)
- Example: "32nd ranked defense" = the WEAKEST defense = GREAT matchup
- Example: "1st ranked defense" = the STRONGEST defense = TOUGH matchup
- NEVER say "32nd toughest" - 32nd is the EASIEST, not toughest!

For each recommendation you must:
1. Consider matchups using correct defensive ranking interpretation above
2. Account for bye weeks and injuries
3. Compare projected points (MUST follow the 2-point rule above)
4. Evaluate upside and floor
5. Provide specific, actionable reasoning

Return ONLY a valid JSON array of recommendations. Each recommendation must have:
- benchPlayerName: exact name from bench list
- starterPlayerName: exact name from starter list  
- reasoning: detailed explanation (50-100 words)
- projectedGain: estimated point improvement (number)
- winProbabilityChange: estimated win % improvement (number)

If no improvements needed, return empty array: []

Format: [{"benchPlayerName":"...","starterPlayerName":"...","reasoning":"...","projectedGain":2.5,"winProbabilityChange":4.2}]`
          },
          {
            role: 'user',
            content: `Analyze this lineup for week ${week || 1}:\n\n${JSON.stringify(lineupContext, null, 2)}\n\nProvide start/sit recommendations as JSON array.`
          }
        ],
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again in a moment.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits depleted. Please add credits to continue.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const errorText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errorText);
      throw new Error('AI analysis failed');
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content || '[]';
    
    console.log('AI response:', aiContent);

    // Parse AI recommendations
    let aiRecommendations: any[] = [];
    try {
      // Extract JSON from markdown code blocks if present
      const jsonMatch = aiContent.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/) || 
                       aiContent.match(/(\[[\s\S]*?\])/);
      const jsonStr = jsonMatch ? jsonMatch[1] : aiContent;
      aiRecommendations = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError, aiContent);
      aiRecommendations = [];
    }

    // Map AI recommendations to actual player objects and enforce rules
    const recommendations: Recommendation[] = aiRecommendations
      .map((rec: any) => {
        const benchPlayer = bench.find((p: Player) => 
          p.name.toLowerCase() === rec.benchPlayerName?.toLowerCase()
        );
        const starterPlayer = starters.find((p: Player) => 
          p.name.toLowerCase() === rec.starterPlayerName?.toLowerCase()
        );

        if (!benchPlayer || !starterPlayer) {
          console.warn('Could not match players:', rec.benchPlayerName, rec.starterPlayerName);
          return null;
        }

        // Validate that positions match
        if (benchPlayer.position !== starterPlayer.position) {
          console.warn('Position mismatch:', benchPlayer.position, starterPlayer.position);
          return null;
        }

        // CRITICAL: Never recommend replacing a player who has already played (locked in)
        const starterHasPlayed = starterPlayer.actualPoints !== undefined && starterPlayer.actualPoints > 0;
        if (starterHasPlayed) {
          console.warn(`Filtered out locked player: ${starterPlayer.name} has already played with ${starterPlayer.actualPoints} actual points`);
          return null;
        }

        // CRITICAL: Enforce 2-point rule - bench player must not be projected 2+ points lower
        const projectionDifference = (Number(benchPlayer.projected) || 0) - (Number(starterPlayer.projected) || 0);
        if (projectionDifference < -2) {
          console.warn(`Filtered out bad recommendation: ${benchPlayer.name} (${benchPlayer.projected}) would replace ${starterPlayer.name} (${starterPlayer.projected}), losing ${Math.abs(projectionDifference).toFixed(1)} points`);
          return null;
        }

        return {
          benchPlayer,
          starterPlayer,
          reasoning: rec.reasoning || 'AI analysis suggests this swap.',
          projectedGain: Number.isFinite(projectionDifference) ? Number(projectionDifference.toFixed(1)) : (Number(rec.projectedGain) || 0),
          winProbabilityChange: Number(rec.winProbabilityChange) || 0,
        };
      })
      .filter((rec): rec is Recommendation => rec !== null);

    console.log('Final recommendations:', recommendations.length);

    return new Response(
      JSON.stringify({ recommendations }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in analyze-lineup:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Analysis failed',
        recommendations: [] 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
