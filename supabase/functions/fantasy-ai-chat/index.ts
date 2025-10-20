import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Extract and validate JWT to identify user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse JWT to extract user ID for logging and monitoring
    let userId: string | null = null;
    try {
      const jwt = authHeader.replace('Bearer ', '');
      const [, payload] = jwt.split('.');
      const decodedPayload = JSON.parse(atob(payload));
      userId = decodedPayload.sub || null;
    } catch (e) {
      console.error("Failed to parse JWT:", e);
      // Continue without user ID - JWT verification is handled by Supabase
    }

    const { messages, leagueContext, leagueId, teamRoster } = await req.json();
    
    // Log request for monitoring and abuse prevention
    console.log(`AI chat request from user: ${userId || 'unknown'}, message count: ${messages?.length || 0}`);
    
    // Validate message structure and length
    const MAX_MESSAGE_LENGTH = 2000;
    const MAX_CONVERSATION_LENGTH = 50;
    
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "Invalid request format." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    if (messages.length > MAX_CONVERSATION_LENGTH) {
      return new Response(
        JSON.stringify({ error: "Conversation is too long. Please start a new chat." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    for (const msg of messages) {
      if (!msg.role || !msg.content || typeof msg.content !== 'string') {
        return new Response(
          JSON.stringify({ error: "Invalid message format." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (msg.content.length > MAX_MESSAGE_LENGTH) {
        return new Response(
          JSON.stringify({ error: `Message is too long. Please limit to ${MAX_MESSAGE_LENGTH} characters.` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      console.error("AI service configuration error");
      return new Response(
        JSON.stringify({ error: "Service temporarily unavailable. Please try again later." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build enhanced system prompt with league context
    let systemPrompt = `You are a fast, concise Fantasy Football AI assistant. Provide SHORT, ACCURATE answers.

CRITICAL RESPONSE RULES:
- Give ONE-LINE verdicts for start/sit and trade questions
- Use format: "Start [Player] — [reason in 5 words or less]"
- For trades: "Accept — +X pts ROS advantage" or "Reject — [brief reason]"
- NO long paragraphs, NO filler phrases like "Here's what I think"
- Be direct, confident, neutral
- Only ask follow-up if CRITICAL context is missing

ANALYSIS FACTORS:
- Recent performance (last 3-4 games), matchups, target share, snap count
- Injuries, bye weeks, opponent defense rankings
- Weather for outdoor games (affects kickers/passing)
- Playoff schedules for long-term trades

EXAMPLE RESPONSES:
✓ "Start Gibbs — +3.4 pts projection over Stevenson."
✓ "Accept — +8 pts ROS, gains WR depth."
✓ "Reject — losing your only top-tier RB."
✗ "I think you should consider starting Gibbs because he has been performing well..."`;

    // Add league-specific context if provided
    if (leagueContext) {
      systemPrompt += `\n\nLEAGUE CONTEXT: ${leagueContext}`;
    }
    
    if (teamRoster) {
      const rosterSummary = typeof teamRoster === 'object' ? 
        `Roster: ${teamRoster.starters?.length || 0} starters, ${teamRoster.bench?.length || 0} bench` :
        'Roster data available';
      systemPrompt += `\n${rosterSummary}`;
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits depleted. Please contact support." }),
          {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      
      console.error("AI service error:", response.status);
      return new Response(
        JSON.stringify({ error: "Unable to process your request. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const aiMessage = data.choices[0].message.content;

    return new Response(
      JSON.stringify({ message: aiMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Fantasy AI chat error:", error);
    return new Response(
      JSON.stringify({ error: "Unable to process your request. Please try again." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
