import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase for rate limiting
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create user-authenticated client
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.39.3?target=deno');
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Verify user authentication
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Authentication failed' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check rate limit (15 requests per 5 minutes for trade evaluation)
    const rateLimitResult = await supabase.rpc('check_rate_limit', {
      p_user_id: user.id,
      p_endpoint: 'evaluate-trade',
      p_max_requests: 15,
      p_window_minutes: 5
    });

    if (rateLimitResult.error) {
      console.error('Rate limit check failed:', rateLimitResult.error);
    } else if (!rateLimitResult.data?.allowed) {
      return new Response(
        JSON.stringify({ 
          error: 'Rate limit exceeded. Please wait before evaluating another trade.',
          retryAfter: rateLimitResult.data?.reset_at
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const { myTeam, theirTeam, scoringType } = await req.json();

    console.log('Evaluating trade:', {
      myPlayers: myTeam.tradingAway.length,
      theirPlayers: theirTeam.tradingAway.length,
      scoringType,
    });

    // Calculate current team totals
    const myCurrentTotal = myTeam.roster.reduce((sum: number, p: any) => sum + (p.projected || 0), 0);
    const theirCurrentTotal = theirTeam.roster.reduce((sum: number, p: any) => sum + (p.projected || 0), 0);

    // Calculate trading away totals
    const myTradingValue = myTeam.tradingAway.reduce((sum: number, p: any) => sum + (p.projected || 0), 0);
    const theirTradingValue = theirTeam.tradingAway.reduce((sum: number, p: any) => sum + (p.projected || 0), 0);

    // Calculate post-trade totals
    const myPostTradeTotal = myCurrentTotal - myTradingValue + theirTradingValue;
    const pointsChange = myPostTradeTotal - myCurrentTotal;

    // Build positional analysis
    const getPositionalBreakdown = (roster: any[]) => {
      const breakdown: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
      roster.forEach((p: any) => {
        const pos = p.position.toUpperCase();
        if (breakdown.hasOwnProperty(pos)) {
          breakdown[pos] += p.projected || 0;
        }
      });
      return breakdown;
    };

    const myCurrentPositions = getPositionalBreakdown(myTeam.roster);
    const myPostTradeRoster = [
      ...myTeam.roster.filter((p: any) => !myTeam.tradingAway.find((t: any) => t.id === p.id)),
      ...theirTeam.tradingAway,
    ];
    const myPostTradePositions = getPositionalBreakdown(myPostTradeRoster);

    // Create prompt for AI evaluation
    const prompt = `Analyze this fantasy football trade for ${scoringType} scoring:

MY TEAM IS TRADING AWAY:
${myTeam.tradingAway.map((p: any) => `- ${p.name} (${p.position}, ${p.team}) - ${p.projected} projected ROS pts`).join('\n')}
Total Value: ${myTradingValue.toFixed(1)} points

RECEIVING IN RETURN:
${theirTeam.tradingAway.map((p: any) => `- ${p.name} (${p.position}, ${p.team}) - ${p.projected} projected ROS pts`).join('\n')}
Total Value: ${theirTradingValue.toFixed(1)} points

MY CURRENT ROSTER STRENGTH:
${Object.entries(myCurrentPositions).map(([pos, pts]) => `${pos}: ${(pts as number).toFixed(1)} pts`).join(', ')}

POST-TRADE ROSTER STRENGTH:
${Object.entries(myPostTradePositions).map(([pos, pts]) => `${pos}: ${(pts as number).toFixed(1)} pts`).join(', ')}

NET CHANGE: ${pointsChange >= 0 ? '+' : ''}${pointsChange.toFixed(1)} rest-of-season points

Provide a comprehensive trade analysis considering:
1. Overall value gained/lost
2. Positional depth impact (are we getting too thin at any position?)
3. Playoff schedule strength (weeks 15-17)
4. Any injury risks or bye week concerns
5. Whether this trade makes strategic sense

Respond ONLY with a JSON object in this exact format (no markdown, no additional text):
{
  "verdict": "accept" or "decline" or "balanced",
  "grade": "A" through "F",
  "confidence": 0-100,
  "summary": "2-3 sentence explanation of the recommendation",
  "positionalImpacts": [
    {
      "position": "QB",
      "impact": "Brief analysis of impact at this position"
    }
  ]
}`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are an expert fantasy football analyst. Provide detailed, strategic trade analysis. Always respond with valid JSON only.' },
          { role: 'user', content: prompt }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI API error:', response.status, errorText);
      throw new Error('AI evaluation failed');
    }

    const aiData = await response.json();
    let aiAnalysis;
    
    try {
      const content = aiData.choices[0].message.content;
      // Try to extract JSON if wrapped in markdown
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      aiAnalysis = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiData.choices[0].message.content);
      // Fallback to basic analysis
      aiAnalysis = {
        verdict: pointsChange > 5 ? "accept" : pointsChange < -5 ? "decline" : "balanced",
        grade: pointsChange > 10 ? "A" : pointsChange > 5 ? "B" : pointsChange > 0 ? "C" : pointsChange > -5 ? "D" : "F",
        confidence: 70,
        summary: `This trade results in a ${pointsChange >= 0 ? 'gain' : 'loss'} of ${Math.abs(pointsChange).toFixed(1)} rest-of-season points.`,
        positionalImpacts: []
      };
    }

    // Build detailed positional analysis
    const positionalAnalysis = Object.keys(myCurrentPositions).map(position => {
      const before = myCurrentPositions[position];
      const after = myPostTradePositions[position];
      const change = after - before;
      
      const impact = aiAnalysis.positionalImpacts?.find((p: any) => p.position === position)?.impact || 
        (change > 5 ? "Significant improvement" : 
         change > 0 ? "Slight improvement" : 
         change === 0 ? "No change" : 
         change > -5 ? "Slight decline" : "Significant decline");

      return {
        position,
        before,
        after,
        impact,
      };
    });

    // Generate weekly projections (simplified - would need actual weekly data)
    const weeklyProjections = Array.from({ length: 8 }, (_, i) => {
      const week = i + 10; // Weeks 10-17 (rest of season)
      const weeklyChange = pointsChange / 8;
      return {
        week,
        before: myCurrentTotal / 17 * (week <= 17 ? 1 : 0),
        after: myPostTradeTotal / 17 * (week <= 17 ? 1 : 0),
      };
    });

    const result = {
      verdict: aiAnalysis.verdict,
      grade: aiAnalysis.grade,
      confidence: aiAnalysis.confidence,
      pointsChange,
      summary: aiAnalysis.summary,
      positionalAnalysis,
      weeklyProjections: weeklyProjections.slice(0, 5), // Show next 5 weeks
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in evaluate-trade function:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to evaluate trade' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
