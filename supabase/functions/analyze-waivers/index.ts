import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


// 2025-26 NFL Bye Week Schedule
const byeWeekSchedule2025 = new Map<string, number>([
  ['ATL', 5], ['CHI', 5], ['GB', 5], ['PIT', 5],
  ['HOU', 6], ['MIN', 6],
  ['BAL', 7], ['BUF', 7],
  ['ARI', 8], ['DET', 8], ['JAX', 8], ['LV', 8], ['LA', 8], ['SEA', 8],
  ['CLE', 9], ['NYJ', 9], ['PHI', 9], ['TB', 9],
  ['CIN', 10], ['DAL', 10], ['KC', 10], ['TEN', 10],
  ['IND', 11], ['NO', 11],
  ['DEN', 12], ['LAC', 12], ['MIA', 12], ['WAS', 12],
  ['CAR', 14], ['NE', 14], ['NYG', 14], ['SF', 14],
]);

function isTeamOnBye(team: string | undefined | null, week: number): boolean {
  if (!team) return false;
  const teamBye = byeWeekSchedule2025.get(team);
  return teamBye === week;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { roster, waiverPlayers, currentWeek } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Fetch accurate projections for roster players from sleeper_projections
    const rosterPlayerIds = roster
      .map((p: any) => p.sleeper_id)
      .filter((id: string) => id);

    let projectionsMap = new Map<string, number>();
    
    if (rosterPlayerIds.length > 0 && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const projResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/sleeper_projections?player_id=in.(${rosterPlayerIds.join(',')})&week=eq.${currentWeek}&season=eq.2025&select=player_id,pts_ppr`,
        {
          headers: {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          }
        }
      );
      
      if (projResponse.ok) {
        const projections = await projResponse.json();
        projections.forEach((proj: any) => {
          projectionsMap.set(proj.player_id, proj.pts_ppr || 0);
        });
      }
    }

    // Prepare roster summary with accurate projections
    const rosterSummary = roster.map((p: any) => {
      const accurateProjection = p.sleeper_id ? projectionsMap.get(p.sleeper_id) : null;
      return {
        name: p.player_name || p.name,
        position: p.position,
        projected: accurateProjection ?? (p.projected_fp || p.projected || 0),
        byeWeek: isTeamOnBye(p.team, currentWeek),
        isInjured: p.injury_status && p.injury_status !== 'ACTIVE',
        team: p.team
      };
    });

    // Calculate position counts
    const positionCounts = new Map<string, number>();
    rosterSummary.forEach((p: any) => {
      positionCounts.set(p.position, (positionCounts.get(p.position) || 0) + 1);
    });

    // Take top waiver players by position
    const topWaiverPlayers = waiverPlayers.slice(0, 50).map((p: any) => ({
      name: p.name,
      position: p.position,
      team: p.team,
      opponent: p.opponent,
      projected: p.projected,
      oppDefRank: p.oppDefRank,
      byeWeek: isTeamOnBye(p.team, currentWeek)
    }));

    const systemPrompt = `You are an expert fantasy football waiver wire analyst. Analyze the user's roster and suggest ONLY waiver wire pickups that will meaningfully improve their team's TOTAL VALUE.

CRITICAL VALIDATION RULES - THESE ARE ABSOLUTE:
1. NEVER recommend a waiver player who projects LOWER than the player to drop - NO EXCEPTIONS
2. ONLY recommend additions where waiver player projection > roster player projection
3. Matchup advantages, defensive rankings, or "upside" DO NOT override lower projections
4. If waiver player projects 6.7 and roster player projects 8.09, DO NOT recommend this swap - even with better matchup
5. Minimum projection advantage should be +2 points for a clear recommendation
6. Focus ONLY on improving total team value through higher projections

CORE PHILOSOPHY:
- Every roster move should increase your team's total projected points
- Swapping bench players for lower-projected players (even with better matchups) DECREASES team value
- One week's matchup advantage does not justify a projection downgrade
- Better to make 0 recommendations than suggest value-destroying swaps

PRIORITY RULES:
1. ALWAYS recommend adding a waiver player if they project 2+ points higher than a rostered player at the same position
2. For 1-2 point advantages, only recommend if the upgrade is clear and consistent


PROTECTION RULES (do not drop these players):
3. NEVER drop a player if they are the ONLY player at that position on the roster (e.g., don't drop your only Kicker, only TE, only QB, etc.)
4. NEVER drop a bench player for a waiver player with LOWER projections, regardless of matchup
5. Players explicitly marked [ON BYE] - they have future value after the bye week
6. Players marked [INJURED] who are star players or proven producers - they will return

DATA INTERPRETATION:
7. Only consider a player on BYE if they have the [ON BYE] marker - DO NOT assume 0 projections means bye week
8. If a player has 0 projections but NO [ON BYE] marker, they likely have missing data - do not recommend them
9. Defensive rankings are informational only - DO NOT use them to justify picking up lower-projected players

RECOMMENDATION QUALITY:
10. Only provide recommendations that genuinely INCREASE total team value
11. If there are no clear upgrades available (waiver player projects higher), return an empty array
12. Do not force recommendations just to provide output
13. Better to give 0 recommendations than suggest a value-destroying swap
14. NEVER justify a swap by saying a lower-projected player "offers higher upside" due to matchup

For each recommendation, provide:
- Player to add (MUST have HIGHER projection than player to drop - NO EXCEPTIONS)
- Player to drop (if applicable, not protected by rules above)
- Specific reasoning based ONLY on projection difference (do not mention matchups if projection is lower)
- Projected point gain (difference in projections, MUST BE POSITIVE - negative values are invalid)

Return recommendations as a JSON array. If no recommendations meet the quality bar (positive projection gain), return [].

Example VALID recommendation:
[{
  "playerToAdd": "Aaron Rodgers",
  "playerToDrop": "Jared Goff",
  "reasoning": "Aaron Rodgers projects for 20.6 points, a +3.2 advantage over Jared Goff's 17.4 projection this week.",
  "projectedGain": 3.2
}]

Example INVALID recommendations (DO NOT DO THESE):
[{
  "playerToAdd": "Noah Fant",
  "playerToDrop": "T.J. Hockenson",
  "reasoning": "Fant has better matchup despite lower projection",
  "projectedGain": -1.39
}]
This is WRONG because Fant (6.7) projects LOWER than Hockenson (8.09). NEVER recommend this.

[{
  "playerToAdd": "Dawson Knox",
  "playerToDrop": "T.J. Hockenson",
  "reasoning": "Knox faces easier defense",
  "projectedGain": -1.39
}]
This is WRONG because Knox projects LOWER. Matchup does not override projections.`;

    const userPrompt = `Current Week: ${currentWeek}

ROSTER POSITION COUNTS:
${Array.from(positionCounts.entries()).map(([pos, count]) => `${pos}: ${count} player${count !== 1 ? 's' : ''}`).join('\n')}

MY ROSTER:
${rosterSummary.map((p: any) => 
  `${p.name} (${p.position}) - ${p.team} - Proj: ${p.projected}${p.byeWeek ? ' [ON BYE]' : ''}${p.isInjured ? ' [INJURED]' : ''}`
).join('\n')}

TOP AVAILABLE PLAYERS:
${topWaiverPlayers.map((p: any) => 
  `${p.name} (${p.position}) - ${p.team} vs ${p.opponent} - Proj: ${p.projected} - Opp Def Rank: ${p.oppDefRank || 'N/A'}${p.byeWeek ? ' [ON BYE]' : ''}`
).join('\n')}

Analyze and provide waiver recommendations.`;

    console.log('Calling Lovable AI for waiver analysis...');

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI API error:', response.status, errorText);
      throw new Error(`AI API returned ${response.status}: ${errorText}`);
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices[0].message.content;
    
    console.log('AI response:', content);

    // Try to extract JSON from the response
    let recommendations = [];
    try {
      // Remove markdown code blocks if present
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, content];
      const jsonStr = jsonMatch[1] || content;
      recommendations = JSON.parse(jsonStr.trim());
    } catch (e) {
      console.error('Failed to parse AI response as JSON:', e);
      console.log('Raw content:', content);
      
      // Fallback: create a generic recommendation
      recommendations = [{
        playerToAdd: waiverPlayers[0]?.name || 'Top available player',
        playerToDrop: null,
        reasoning: 'Consider adding high-projected available players to strengthen your roster.',
        projectedGain: 0
      }];
    }

    return new Response(
      JSON.stringify({ recommendations }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in analyze-waivers function:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        recommendations: []
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
