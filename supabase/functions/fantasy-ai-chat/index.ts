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
    const { messages } = await req.json();
    
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

    // System prompt with fantasy football context and data
    const systemPrompt = `You are an expert Fantasy Football AI assistant. You help users make informed decisions about start/sit choices, trade evaluations, waiver pickups, and roster management.

Key Guidelines:
- Provide data-driven advice based on recent performance, matchups, and trends
- Consider factors like: target share, snap count, opponent defense rankings, weather conditions, and injury reports
- When analyzing trades, evaluate both immediate value and long-term potential
- For start/sit decisions, prioritize players with favorable matchups and consistent usage
- Always explain your reasoning clearly and concisely
- If you need more specific information (scoring format, league settings), ask clarifying questions

Current 2024 NFL Context:
- Focus on recent weeks' performance (last 3-4 games) over season averages
- Consider bye weeks and playoff schedules
- Account for team offensive schemes and play-calling tendencies
- Factor in weather for outdoor games (especially for kickers and passing games)`;

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
