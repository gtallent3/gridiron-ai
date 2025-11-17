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

    // First get the league to find user's team_id
    const leagueResult = await supabase
      .from('connected_leagues')
      .select('*')
      .eq('id', leagueId)
      .eq('user_id', userId)
      .single();

    if (leagueResult.error || !leagueResult.data) {
      return new Response(
        JSON.stringify({ error: "League not found." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const league = leagueResult.data;
    const userTeamId = league.user_team_id;

    // Now fetch all data in parallel using the correct team_id
    const [userTeamResult, allTeamsResult, posStrengthsResult, topPlayersResult] = await Promise.all([
      supabase.from('user_teams').select('*').eq('team_id', userTeamId).eq('league_id', leagueId).single(),
      supabase.from('user_teams').select('*').eq('league_id', leagueId),
      supabase.from('team_positional_strengths').select('*').eq('league_id', leagueId),
      supabase.from('trade_value_weekly').select('*').order('trade_value', { ascending: false }).limit(150)
    ]);

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
      
      const roster = Array.isArray(userTeam.roster) ? userTeam.roster : [];
      
      // Separate starters from bench based on slot positions
      // Slots 0-15 are typically starters, 20+ are bench
      const starters = roster.filter((p: any) => p.slot < 20);
      const bench = roster.filter((p: any) => p.slot >= 20);
      
      if (starters.length > 0) {
        contextParts.push(`\nStarting Lineup (${starters.length}):`);
        starters.forEach((p: any) => {
          contextParts.push(`- ${p.player_name} (${p.position}, ${p.team || 'FA'}) - Proj: ${p.projected || 'N/A'} pts`);
        });
      }
      
      if (bench.length > 0) {
        contextParts.push(`\nBench (${bench.length}):`);
        bench.forEach((p: any) => {
          contextParts.push(`- ${p.player_name} (${p.position}, ${p.team || 'FA'}) - Proj: ${p.projected || 'N/A'} pts`);
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

    const systemPrompt = `You are an expert fantasy football AI assistant. You MUST follow these strict rules:

CONTEXT:
${contextParts.join('\n')}

DATASET RULES (CRITICAL):
1. For START/SIT questions → Use ONLY get_start_sit_data tool to query player_pool_v2 table
2. For TRADE questions → Use ONLY get_trade_data tool to query player_rankings table
3. NEVER mix datasets or reference unavailable data
4. ALWAYS call the appropriate tool immediately - fuzzy matching will find players by partial names
5. NEVER ask users for full player names or teams - just use what they provide

QUESTION DETECTION:
- START/SIT keywords: "start", "sit", "bench", "flex", "play", "lineup", "who should I", "better play"
- TRADE keywords: "trade", "deal", "value", "offer", "worth", "accept", "swap"

PLAYER NAME HANDLING:
- Accept ANY player name format: "Waddle", "Jaylen Waddle", "waddle", etc.
- Fuzzy matching system will find the correct player automatically
- If user says "Start?Sit Waddle and Hill" → Call tool with ["Waddle", "Hill"]
- NEVER respond with "I need full names" - the system handles partial names

RESPONSE FORMAT:
1. START/SIT answers:
   - Format: "Start [Player Name]"
   - Show: "Week X Projections — Player A: X.X pts | Player B: X.X pts"
   - Reason: One short sentence explaining the difference
   - If difference <1.0 pts: "Close call — start [player] slightly ahead"
   - If difference >2.0 pts: "Start [player] confidently this week"

2. TRADE answers:
   - Format: "Trade Verdict: [Accept/Decline]"
   - CRITICAL: Tool returns object with "trade_value_score" and "projected_ppg" - THESE ARE DIFFERENT NUMBERS!
   - Display format: "[Player Name] (Trade Value: [use trade_value_score], Proj ROS PPG: [use projected_ppg])"
   - VALIDATION: Trade Value is typically 0-100, PPG is typically 5-25. If they're the same, YOU MADE AN ERROR!
   - Example: {player_name: "Brock Bowers", trade_value_score: 50.0, projected_ppg: 16.4}
     CORRECT: "Brock Bowers (Trade Value: 50.0, Proj ROS PPG: 16.4)"
     WRONG: "Brock Bowers (Trade Value: 16.4, Proj ROS PPG: 16.4)" ← DO NOT DO THIS!
   - Show totals: "Side A Total: XX.X | Side B Total: XX.X" (sum trade_value_score for each side)
   - Reason: One sentence about ROS value and position depth

FORMATTING RULES:
- NEVER use asterisks (*) for emphasis or formatting
- Use clear, plain text without markdown bold syntax
- Keep responses professional and easy to read

RULES:
- Default to current week (${currentWeek}) unless user specifies otherwise
- Exclude players marked OUT or on bye week
- Be direct and concise - no generic responses
- MISSING DATA HANDLING:
  * If ONE player has projections and the other doesn't: State "[Player without data] is not projected any points this week. Start [Player with data] who is projected X.X points."
  * If BOTH players have no projections: State "Neither player is projected any points this week, making a data-based recommendation impossible."
  * If ALL players have projections: Provide normal comparison
- Always call the appropriate tool based on question type`;

    const tools = [
      {
        type: "function",
        function: {
          name: "get_start_sit_data",
          description: "Get current week projections for start/sit decisions from player_pool_v2 table",
          parameters: {
            type: "object",
            properties: {
              player_names: {
                type: "array",
                description: "Array of player names to compare",
                items: { type: "string" }
              },
              week: {
                type: "number",
                description: "Week number (defaults to current week)"
              }
            },
            required: ["player_names"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_trade_data",
          description: "Get player data for trades. Returns object with 'trade_value_score' (0-100 scale, use for Trade Value) and 'projected_ppg' (points per game, use for Proj ROS PPG). These are ALWAYS different numbers!",
          parameters: {
            type: "object",
            properties: {
              player_names: {
                type: "array",
                description: "Array of all players involved in the trade",
                items: { type: "string" }
              }
            },
            required: ["player_names"]
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

          // Process tool calls if any
          if (toolCalls.length > 0) {
            console.log('Processing tool calls:', toolCalls);
            
            const toolMessages: any[] = [];
            
            // Add assistant's tool call message
            toolMessages.push({
              role: 'assistant',
              content: fullContent || null,
              tool_calls: toolCalls
            });
            
            // Execute tools and collect results
            for (const toolCall of toolCalls) {
              const funcName = toolCall.function.name;
              const args = JSON.parse(toolCall.function.arguments);
              
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'tool_call', name: funcName, args })}\n\n`));

              let toolResult;
              try {
                if (funcName === 'get_start_sit_data') {
                  const week = args.week || currentWeek;
                  const playerNames = args.player_names || [];

                  // Use fuzzy matching to find players by name
                  const foundPlayers: any[] = [];
                  for (const inputName of playerNames) {
                    const nameTrimmed = inputName.trim();
                    
                    // Try exact match first
                    let { data: exactMatch } = await supabase
                      .from('player_pool_v2')
                      .select('player_name, position, team, projected_fp, bye_week, opponent')
                      .eq('week', week)
                      .eq('season', currentSeason)
                      .ilike('player_name', nameTrimmed)
                      .limit(1)
                      .single();
                    
                    if (exactMatch) {
                      foundPlayers.push(exactMatch);
                      continue;
                    }
                    
                    // Fuzzy match: split input into parts and match each
                    const nameParts = nameTrimmed.toLowerCase().split(/\s+/);
                    let query = supabase
                      .from('player_pool_v2')
                      .select('player_name, position, team, projected_fp, bye_week, opponent')
                      .eq('week', week)
                      .eq('season', currentSeason);
                    
                    // Match all name parts using ILIKE
                    for (const part of nameParts) {
                      query = query.ilike('player_name', `%${part}%`);
                    }
                    
                    const { data: fuzzyMatches } = await query.limit(3);
                    
                    if (fuzzyMatches && fuzzyMatches.length > 0) {
                      // Take the first match (best match)
                      foundPlayers.push(fuzzyMatches[0]);
                    }
                  }

                  // Filter out bye week players and format data
                  const validPlayers = foundPlayers
                    .filter((p: any) => !p.bye_week)
                    .map((p: any) => ({
                      player_name: p.player_name,
                      position: p.position,
                      team: p.team,
                      projected_fp: p.projected_fp || 0,
                      opponent: p.opponent
                    }));

                  toolResult = {
                    week,
                    players: validPlayers,
                    data_source: 'player_pool_v2'
                  };
                } else if (funcName === 'get_trade_data') {
                  const playerNames = args.player_names || [];

                  // Use fuzzy matching to find players by name
                  const foundPlayers: any[] = [];
                  for (const inputName of playerNames) {
                    const nameTrimmed = inputName.trim();
                    
                    // Try exact match first
                    let { data: exactMatch } = await supabase
                      .from('player_rankings')
                      .select('player_name, position, team, trade_value, avg_projected_ppg_ros')
                      .eq('season', currentSeason)
                      .ilike('player_name', nameTrimmed)
                      .limit(1)
                      .single();
                    
                    if (exactMatch) {
                      foundPlayers.push(exactMatch);
                      continue;
                    }
                    
                    // Fuzzy match: split input into parts and match each
                    const nameParts = nameTrimmed.toLowerCase().split(/\s+/);
                    let query = supabase
                      .from('player_rankings')
                      .select('player_name, position, team, trade_value, avg_projected_ppg_ros')
                      .eq('season', currentSeason);
                    
                    // Match all name parts using ILIKE
                    for (const part of nameParts) {
                      query = query.ilike('player_name', `%${part}%`);
                    }
                    
                    const { data: fuzzyMatches } = await query.limit(3);
                    
                    if (fuzzyMatches && fuzzyMatches.length > 0) {
                      // Take the first match (best match)
                      foundPlayers.push(fuzzyMatches[0]);
                    }
                  }

                  const players = foundPlayers.map((p: any) => ({
                    player_name: p.player_name,
                    position: p.position,
                    team: p.team,
                    trade_value_score: p.trade_value || 0,
                    projected_ppg: p.avg_projected_ppg_ros || 0
                  }));

                  toolResult = {
                    players,
                    WARNING: "trade_value_score and projected_ppg are DIFFERENT numbers - do not confuse them!",
                    data_source: 'player_rankings'
                  };
                }

                // Add tool result message
                toolMessages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(toolResult)
                });

                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'tool_result', name: funcName, result: toolResult })}\n\n`));
              } catch (error) {
                console.error(`Error executing tool ${funcName}:`, error);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'tool_error', name: funcName, error: String(error) })}\n\n`));
                
                // Add error result
                toolMessages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: JSON.stringify({ error: String(error) })
                });
              }
            }
            
            // Make second AI call with tool results to get final answer
            console.log('Making second AI call with tool results');
            const secondAiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${lovableApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'google/gemini-2.5-flash',
                messages: [
                  { role: 'system', content: systemPrompt },
                  ...messages,
                  ...toolMessages
                ],
                stream: true,
              }),
            });
            
            if (secondAiResponse.ok) {
              const secondReader = secondAiResponse.body?.getReader();
              let secondBuffer = '';
              
              while (true) {
                const { done, value } = await secondReader!.read();
                if (done) break;

                secondBuffer += decoder.decode(value, { stream: true });
                const lines = secondBuffer.split('\n');
                secondBuffer = lines.pop() || '';

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
                  } catch (e) {
                    console.error('Error parsing second AI response:', e);
                  }
                }
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
