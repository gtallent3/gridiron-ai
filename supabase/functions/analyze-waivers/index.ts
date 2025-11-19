import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { roster, waiverPlayers, currentWeek } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Prepare roster summary
    const rosterSummary = roster.map((p: any) => ({
      name: p.player_name || p.name,
      position: p.position,
      projected: p.projected_fp || p.projected || 0,
      byeWeek: p.bye_week || p.byeWeek || false,
      isInjured: p.injury_status && p.injury_status !== 'ACTIVE',
      team: p.team
    }));

    // Take top waiver players by position
    const topWaiverPlayers = waiverPlayers.slice(0, 50).map((p: any) => ({
      name: p.name,
      position: p.position,
      team: p.team,
      opponent: p.opponent,
      projected: p.projected,
      oppDefRank: p.oppDefRank,
      byeWeek: p.byeWeek
    }));

    const systemPrompt = `You are an expert fantasy football waiver wire analyst. Analyze the user's roster and suggest specific waiver wire pickups.

CRITICAL RULES:
1. DO NOT recommend dropping players who are on bye this week - they have future value
2. DO NOT recommend dropping injured players with high projections - they will return
3. Consider positional depth - don't drop the only viable backup at a position
4. Look for players with favorable matchups (low opponent defense rank = easier matchup)
5. Prioritize players with consistent projections over boom-bust options
6. Consider the current week context

For each recommendation, provide:
- Player to add
- Player to drop (if applicable)
- Specific reasoning based on matchup, projections, and roster context
- Projected point gain

Return recommendations as a JSON array with this structure:
[{
  "playerToAdd": "Player Name",
  "playerToDrop": "Player Name or null",
  "reasoning": "Specific analysis...",
  "projectedGain": number
}]

Limit to 3-5 most impactful recommendations.`;

    const userPrompt = `Current Week: ${currentWeek}

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
