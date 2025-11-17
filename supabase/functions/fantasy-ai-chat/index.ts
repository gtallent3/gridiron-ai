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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser(token);
    
    if (authError || !user) {
      console.error("Authentication failed:", authError);
      return new Response(
        JSON.stringify({ error: "Invalid or expired authentication token." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const userId = user.id;

    const rateLimitResult = await supabaseUser.rpc('check_rate_limit', {
      p_user_id: userId,
      p_endpoint: 'fantasy-ai-chat',
      p_max_requests: 10,
      p_window_minutes: 5
    });

    if (rateLimitResult.error) {
      console.error('Rate limit check failed:', rateLimitResult.error);
    } else if (!rateLimitResult.data?.allowed) {
      return new Response(
        JSON.stringify({ 
          error: "Rate limit exceeded. Please wait before making another request.",
          retryAfter: rateLimitResult.data?.reset_at
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { messages, leagueId, conversationId } = await req.json();
    
    console.log(`AI chat request from user: ${userId}, message count: ${messages?.length || 0}`);
    
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

    if (!leagueId) {
      return new Response(
        JSON.stringify({ error: "League ID is required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [leagueResult, userTeamResult, allTeamsResult, posStrengthsResult, topPlayersResult] = await Promise.all([
      supabase.from('connected_leagues').select('*').eq('id', leagueId).single(),
      supabase.from('user_teams').select('*').eq('league_id', leagueId).limit(1).single(),
      supabase.from('user_teams').select('*').eq('league_id', leagueId),
      supabase.from('team_positional_strengths').select('*').eq('league_id', leagueId),
      supabase.from('trade_value_weekly').select('*').order('trade_value', { ascending: false }).limit(150)
    ]);

    if (leagueResult.error || !leagueResult.data) {
      return new Response(
        JSON.stringify({ error: "League not found." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const league = leagueResult.data;
    const userTeam = userTeamResult.data;
    const allTeams = allTeamsResult.data || [];
    const posStrengths = posStrengthsResult.data || [];
    const topPlayers = topPlayersResult.data || [];

    const currentDate = new Date();
    const currentSeason = 2025;
    const currentWeek = league.current_week || 12;
    
    let contextParts = [
      `Current Date: ${currentDate.toISOString().split('T')[0]}`,
      `NFL Season: ${currentSeason}, Week: ${currentWeek}`,
      `League: ${league.league_name} (${league.league_size} teams, ${league.scoring_type} scoring)`,
    ];

    if (userTeam) {
      contextParts.push(`User's Team: ${userTeam.team_name}`);
      contextParts.push(`Record: ${userTeam.wins || 0}-${userTeam.losses || 0}${userTeam.ties ? `-${userTeam.ties}` : ''}`);
      
      const roster = userTeam.roster || {};
      const starters = roster.starters || [];
      const bench = roster.bench || [];
      
      if (starters.length > 0) {
        contextParts.push(`\nStarting Lineup (${starters.length}):`);
        starters.forEach((p: any) => {
          contextParts.push(`- ${p.player_name} (${p.position}, ${p.team || 'FA'}) - Proj: ${p.projected_points?.toFixed(1) || 'N/A'} pts`);
        });
      }
      
      if (bench.length > 0) {
        contextParts.push(`\nBench (${bench.length}):`);
        bench.forEach((p: any) => {
          contextParts.push(`- ${p.player_name} (${p.position}, ${p.team || 'FA'}) - Proj: ${p.projected_points?.toFixed(1) || 'N/A'} pts`);
        });
      }
    }

    if (posStrengths.length > 0 && userTeam) {
      contextParts.push(`\nUser's Positional Strengths:`);
      const userStrengths = posStrengths.filter((ps: any) => ps.team_id === userTeam.team_id);
      userStrengths.forEach((ps: any) => {
        contextParts.push(`- ${ps.position}: Rank #${ps.rank}/${league.league_size} (PSS: ${ps.pss.toFixed(1)})`);
      });
    }

    if (allTeams.length > 0 && userTeam) {
      contextParts.push(`\nOther Teams in League:`);
      const opponents = allTeams.filter((t: any) => t.team_id !== userTeam.team_id);
      opponents.forEach((t: any) => {
        contextParts.push(`- ${t.team_name}: ${t.wins || 0}-${t.losses || 0}${t.ties ? `-${t.ties}` : ''}`);
      });
    }

    contextParts.push(`\nTop ${Math.min(topPlayers.length, 150)} Players by Trade Value:`);
    topPlayers.slice(0, 150).forEach((p: any, idx: number) => {
      contextParts.push(
        `${idx + 1}. ${p.player_name} (${p.position}, ${p.team || 'FA'}) - Trade Value: ${p.trade_value.toFixed(1)}, Proj ROS PPG: ${p.meta_proj_ros_ppg?.toFixed(1) || 'N/A'}`
      );
    });

    const systemPrompt = `You are an expert fantasy football AI assistant with deep knowledge of player performance, trade values, and lineup optimization.

${contextParts.join('\n')}

Your role:
- Provide actionable fantasy advice based on current projections and trade values
- Help evaluate trades using the analyze_trade tool
- Optimize lineups using the analyze_lineup tool
- Suggest position improvements using the find_position_upgrade tool
- Compare players using the compare_players tool
- Keep responses concise and data-driven
- Always reference specific player projections and trade values when making recommendations

When users ask about trades, lineups, position improvements, or player comparisons, USE THE TOOLS provided to give them accurate analysis.`;

    const tools = [
      {
        type: "function",
        function: {
          name: "analyze_trade",
          description: "Evaluate a trade proposal using comprehensive trade value analysis",
          parameters: {
            type: "object",
            properties: {
              teamAPlayers: {
                type: "array",
                description: "Array of player IDs that Team A is giving up",
                items: { type: "string" }
              },
              teamBPlayers: {
                type: "array",
                description: "Array of player IDs that Team B is giving up",
                items: { type: "string" }
              }
            },
            required: ["teamAPlayers", "teamBPlayers"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "analyze_lineup",
          description: "Analyze lineup and provide start/sit recommendations",
          parameters: {
            type: "object",
            properties: {
              week: {
                type: "number",
                description: "Week number (defaults to current week)"
              }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "find_position_upgrade",
          description: "Find trade opportunities to improve a specific position",
          parameters: {
            type: "object",
            properties: {
              position: {
                type: "string",
                description: "Position to upgrade (QB, RB, WR, or TE)",
                enum: ["QB", "RB", "WR", "TE"]
              }
            },
            required: ["position"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "compare_players",
          description: "Compare players side-by-side",
          parameters: {
            type: "object",
            properties: {
              playerIds: {
                type: "array",
                description: "Array of player IDs to compare",
                items: { type: "string" }
              }
            },
            required: ["playerIds"]
          }
        }
      }
    ];

    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableApiKey) {
      return new Response(
        JSON.stringify({ error: "AI service not configured." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        tools,
        tool_choice: 'auto',
        stream: true,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI Gateway error:', aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "AI service rate limit exceeded." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI service quota exceeded." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: "Failed to get AI response." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stream = new ReadableStream({
      async start(controller) {
        const reader = aiResponse.body?.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        
        let buffer = '';
        let fullContent = '';
        let toolCalls: any[] = [];
        let currentToolCall: any = null;

        try {
          while (true) {
            const { done, value } = await reader!.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.trim() || line.startsWith(':')) continue;
              if (!line.startsWith('data: ')) continue;

              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;

                if (delta?.content) {
                  fullContent += delta.content;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', content: delta.content })}\n\n`));
                }

                if (delta?.tool_calls) {
                  for (const toolCall of delta.tool_calls) {
                    if (toolCall.index !== undefined) {
                      if (!toolCalls[toolCall.index]) {
                        toolCalls[toolCall.index] = {
                          id: toolCall.id || '',
                          type: 'function',
                          function: { name: '', arguments: '' }
                        };
                      }
                      currentToolCall = toolCalls[toolCall.index];
                    }

                    if (toolCall.function?.name) {
                      currentToolCall.function.name = toolCall.function.name;
                    }
                    if (toolCall.function?.arguments) {
                      currentToolCall.function.arguments += toolCall.function.arguments;
                    }
                    if (toolCall.id) {
                      currentToolCall.id = toolCall.id;
                    }
                  }
                }
              } catch (e) {
                console.error('Error parsing SSE data:', e);
              }
            }
          }

          if (toolCalls.length > 0) {
            console.log('Processing tool calls:', toolCalls);
            
            for (const toolCall of toolCalls) {
              const funcName = toolCall.function.name;
              const args = JSON.parse(toolCall.function.arguments);
              
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'tool_call', name: funcName, args })}\n\n`));

              let toolResult;
              try {
                if (funcName === 'analyze_trade') {
                  const tradeResponse = await supabase.functions.invoke('evaluate-trade-v3', {
                    body: { leagueId, teamAPlayers: args.teamAPlayers, teamBPlayers: args.teamBPlayers }
                  });
                  toolResult = tradeResponse.data;
                } else if (funcName === 'analyze_lineup') {
                  const lineupResponse = await supabase.functions.invoke('analyze-start-sit', {
                    body: { leagueId, week: args.week || currentWeek }
                  });
                  toolResult = lineupResponse.data;
                } else if (funcName === 'find_position_upgrade') {
                  const upgradeResponse = await supabase.functions.invoke('improve-position', {
                    body: { leagueId, position: args.position }
                  });
                  toolResult = upgradeResponse.data;
                } else if (funcName === 'compare_players') {
                  const playersData = await supabase
                    .from('player_rankings')
                    .select('*')
                    .in('player_id', args.playerIds);
                  toolResult = { players: playersData.data || [] };
                }

                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'tool_result', name: funcName, result: toolResult })}\n\n`));
              } catch (error) {
                console.error(`Error executing tool ${funcName}:`, error);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'tool_error', name: funcName, error: String(error) })}\n\n`));
              }
            }
          }

          if (conversationId) {
            const userMessage = messages[messages.length - 1];
            await supabase.from('chat_messages').insert({
              conversation_id: conversationId,
              role: 'user',
              content: userMessage.content
            });

            if (fullContent) {
              await supabase.from('chat_messages').insert({
                conversation_id: conversationId,
                role: 'assistant',
                content: fullContent
              });
            }
          }

          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        } catch (error) {
          console.error('Streaming error:', error);
          controller.error(error);
        }
      }
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('Edge function error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
