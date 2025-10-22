import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Extract and validate JWT to identify user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cryptographically verify JWT and extract user ID
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.error("Authentication failed:", authError);
      return new Response(
        JSON.stringify({ error: "Invalid or expired authentication token." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const userId = user.id;

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

    // Fetch current NFL data and league details
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;
    const currentSeason = currentMonth >= 9 ? currentYear : currentYear - 1;
    
    // Determine current week (rough estimate)
    const seasonStart = new Date(currentSeason, 8, 1); // Sept 1
    const weeksDiff = Math.floor((currentDate.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
    const currentWeek = Math.max(1, Math.min(18, weeksDiff + 1));

    // Fetch league details if leagueId provided
    let leagueData = null;
    let teamRosterData = null;
    if (leagueId && userId) {
      const { data: league } = await supabase
        .from('connected_leagues')
        .select('*')
        .eq('id', leagueId)
        .eq('user_id', userId)
        .single();
      
      if (league) {
        leagueData = league;
        
        // Fetch user's team roster
        if (league.user_team_id) {
          const { data: team } = await supabase
            .from('user_teams')
            .select('*')
            .eq('league_id', leagueId)
            .eq('team_id', league.user_team_id)
            .single();
          
          if (team) {
            teamRosterData = team.roster;
          }
        }
      }
    }

    // Fetch top player valuations for current context
    const { data: topPlayers } = await supabase
      .from('player_valuations')
      .select('player_name, position, team, ros_projection, next_3_weeks_projection, injury_status, is_bye_week')
      .eq('season', currentSeason)
      .eq('week', currentWeek)
      .order('ros_projection', { ascending: false })
      .limit(100);

    // Build enhanced system prompt with real-time context
    const currentDateStr = currentDate.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    let systemPrompt = `You are a fast, concise Fantasy Football AI assistant. TODAY IS ${currentDateStr}. Current NFL Season: ${currentSeason}, Week ${currentWeek}.

CRITICAL RESPONSE RULES:
- Give ONE-LINE verdicts for start/sit and trade questions
- Use format: "Start [Player] — [reason in 5 words or less]"
- For trades: "Accept — +X pts ROS advantage" or "Reject — [brief reason]"
- NO long paragraphs, NO filler phrases like "Here's what I think"
- Be direct, confident, neutral
- NEVER ask for roster info — you already have it below

ANALYSIS FACTORS:
- Recent performance (last 3-4 games), matchups, target share, snap count
- Injuries, bye weeks, opponent defense rankings
- Weather for outdoor games (affects kickers/passing)
- Playoff schedules (Weeks 15-17) for long-term trades

EXAMPLE RESPONSES:
✓ "Start Gibbs — +3.4 pts projection over Stevenson."
✓ "Accept — +8 pts ROS, gains WR depth."
✓ "Reject — losing your only top-tier RB."
✗ "I think you should consider starting Gibbs because he has been performing well..."`;

    // Add league-specific context
    if (leagueData) {
      systemPrompt += `\n\n=== YOUR LEAGUE ===
League: ${leagueData.league_name}
Size: ${leagueData.league_size} teams
Scoring: ${leagueData.scoring_type}
Current Week: ${leagueData.current_week || currentWeek}`;

      if (leagueData.scoring_settings) {
        const settings = leagueData.scoring_settings;
        systemPrompt += `\nScoring Details: ${JSON.stringify(settings).substring(0, 200)}`;
      }
    }
    
    // Add roster details
    if (teamRosterData) {
      systemPrompt += `\n\n=== YOUR ROSTER ===`;
      
      if (Array.isArray(teamRosterData)) {
        systemPrompt += `\nTotal Players: ${teamRosterData.length}`;
        const positions = teamRosterData.reduce((acc: any, p: any) => {
          acc[p.position] = (acc[p.position] || 0) + 1;
          return acc;
        }, {});
        systemPrompt += `\nPositions: ${JSON.stringify(positions)}`;
        
        // List key players
        const starters = teamRosterData.slice(0, 9);
        systemPrompt += `\nKey Players: ${starters.map((p: any) => `${p.name} (${p.position})`).join(', ')}`;
      } else if (teamRosterData.starters && teamRosterData.bench) {
        systemPrompt += `\nStarters (${teamRosterData.starters.length}): ${teamRosterData.starters.map((p: any) => `${p.name} (${p.position})`).join(', ')}`;
        systemPrompt += `\nBench (${teamRosterData.bench.length}): ${teamRosterData.bench.map((p: any) => `${p.name} (${p.position})`).join(', ')}`;
      }
    }

    // Add current player insights
    if (topPlayers && topPlayers.length > 0) {
      systemPrompt += `\n\n=== CURRENT WEEK ${currentWeek} TOP PLAYERS (ROS Projection) ===`;
      const topByPosition: any = {};
      
      for (const player of topPlayers) {
        if (!topByPosition[player.position] || topByPosition[player.position].length < 5) {
          if (!topByPosition[player.position]) topByPosition[player.position] = [];
          
          const injuryNote = player.injury_status ? ` [${player.injury_status}]` : '';
          const byeNote = player.is_bye_week ? ' [BYE]' : '';
          
          topByPosition[player.position].push(
            `${player.player_name} (${player.team}): ${player.ros_projection.toFixed(1)} ROS, ${player.next_3_weeks_projection.toFixed(1)} next 3wks${injuryNote}${byeNote}`
          );
        }
      }
      
      for (const [pos, players] of Object.entries(topByPosition)) {
        systemPrompt += `\n${pos}: ${(players as string[]).join(' | ')}`;
      }
    }

    systemPrompt += `\n\nUSE THIS DATA to provide accurate, context-aware advice. You have all the info you need — never ask for roster details.`;

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
