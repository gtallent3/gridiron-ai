import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3?target=deno';
import { getCorsHeaders } from "../_shared/cors.ts";


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
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
      
      // Only validate user message length, assistant messages can be longer
      if (msg.role === 'user' && msg.content.length > MAX_MESSAGE_LENGTH) {
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

    // First batch: core league data
    const [userTeamResult, allTeamsResult, posStrengthsResult, topPlayersResult] = await Promise.all([
      supabase.from('user_teams').select('*').eq('team_id', userTeamId).eq('league_id', leagueId).single(),
      supabase.from('user_teams').select('team_id, team_name, wins, losses, ties, roster').eq('league_id', leagueId),
      supabase.from('team_positional_strengths').select('*').eq('league_id', leagueId),
      supabase.from('trade_value_weekly').select('player_name, position, team, trade_value, meta_proj_ros_ppg').order('trade_value', { ascending: false }).limit(150)
    ]);

    const userTeam = userTeamResult.data;
    const allTeams = allTeamsResult.data || [];
    const posStrengths = posStrengthsResult.data || [];
    const topPlayers = topPlayersResult.data || [];

    const currentDate = new Date();
    // NFL season: Sep-Dec = current year, Jan-Aug = previous year
    const currentSeason = currentDate.getMonth() >= 8 ? currentDate.getFullYear() : currentDate.getFullYear() - 1;
    const currentWeek = league.current_week || 1;

    // Build roster name list for enrichment queries
    const roster = Array.isArray(userTeam?.roster) ? userTeam.roster : [];
    const rosterNames = [...new Set(roster.map((p: any) => p.player_name).filter(Boolean))] as string[];

    // Second batch: enrich roster players + opponent team
    const [poolDataResult, opponentTeamResult, rankingsResult] = await Promise.all([
      rosterNames.length > 0
        ? supabase
            .from('player_pool_v2')
            .select('player_name, projected_fp, actual_fp, injury_status, injury_status_explanation, bye_week, opponent, opponent_def_rank')
            .eq('week', currentWeek)
            .eq('season', currentSeason)
            .in('player_name', rosterNames)
        : Promise.resolve({ data: [] as any[] }),
      league.opponent_team_id
        ? supabase.from('user_teams').select('team_name, wins, losses, roster').eq('team_id', league.opponent_team_id).eq('league_id', leagueId).maybeSingle()
        : Promise.resolve({ data: null }),
      rosterNames.length > 0
        ? supabase
            .from('player_rankings')
            .select('player_name, actual_last3_ppg, avg_actual_ppg, trade_value')
            .eq('season', currentSeason)
            .in('player_name', rosterNames)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    // Build lookup maps for enrichment
    const poolByName: Record<string, any> = {};
    for (const p of (poolDataResult.data || [])) poolByName[p.player_name] = p;

    const rankingsByName: Record<string, any> = {};
    for (const p of (rankingsResult.data || [])) rankingsByName[p.player_name] = p;

    const opponentTeam = opponentTeamResult.data;

    // Helper to format a roster player with full context
    const formatPlayer = (p: any) => {
      const pool = poolByName[p.player_name];
      const rank = rankingsByName[p.player_name];
      const proj = pool?.projected_fp ?? p.projected ?? p.proj;
      const last3 = rank?.actual_last3_ppg;
      const status = pool?.injury_status;
      const opp = pool?.opponent;
      const oppRank = pool?.opponent_def_rank;
      const isBye = pool?.bye_week;

      let line = `  - ${p.player_name} (${p.position}, ${p.team || 'FA'})`;
      if (isBye) {
        line += ' — ON BYE';
      } else {
        if (opp) line += ` vs ${opp}${oppRank ? ` (def rank #${oppRank})` : ''}`;
        if (proj != null) line += ` | Proj: ${Number(proj).toFixed(1)} pts`;
        if (last3 != null) line += ` | Last 3 wks avg: ${Number(last3).toFixed(1)} pts`;
      }
      if (status && status !== 'Active' && status !== 'ACTIVE' && status !== 'active') {
        line += ` | Status: ${status}`;
        if (pool?.injury_status_explanation) line += ` (${pool.injury_status_explanation})`;
      }
      return line;
    };

    const starters = roster.filter((p: any) => p.slot < 20 || p.starter === true);
    const bench = roster.filter((p: any) => !(p.slot < 20 || p.starter === true));

    let contextParts = [
      `Current Date: ${currentDate.toISOString().split('T')[0]}`,
      `NFL Season: ${currentSeason}, Week: ${currentWeek}`,
      `League: ${league.league_name} (${league.league_size} teams, ${league.scoring_type} scoring)`,
    ];

    if (userTeam) {
      contextParts.push(`User's Team: ${userTeam.team_name}`);
      contextParts.push(`Record: ${userTeam.wins || 0}-${userTeam.losses || 0}${userTeam.ties ? `-${userTeam.ties}` : ''}`);

      if (starters.length > 0) {
        contextParts.push(`\nStarting Lineup:`);
        starters.forEach((p: any) => contextParts.push(formatPlayer(p)));
      }
      if (bench.length > 0) {
        contextParts.push(`\nBench:`);
        bench.forEach((p: any) => contextParts.push(formatPlayer(p)));
      }
    }

    // This week's matchup with opponent's projected starters
    if (opponentTeam) {
      contextParts.push(`\nThis Week's Matchup vs ${opponentTeam.team_name} (${opponentTeam.wins || 0}-${opponentTeam.losses || 0}):`);
      const oppRoster = Array.isArray(opponentTeam.roster) ? opponentTeam.roster : [];
      const oppStarters = oppRoster.filter((p: any) => p.slot < 20 || p.starter === true);
      if (oppStarters.length > 0) {
        oppStarters.forEach((p: any) => {
          const proj = p.projected ?? p.proj;
          contextParts.push(`  - ${p.player_name} (${p.position}, ${p.team || 'FA'})${proj != null ? ` | Proj: ${Number(proj).toFixed(1)} pts` : ''}`);
        });
        const oppTotal = oppStarters.reduce((sum: number, p: any) => sum + (Number(p.projected ?? p.proj) || 0), 0);
        if (oppTotal > 0) contextParts.push(`  Opponent projected total: ${oppTotal.toFixed(1)} pts`);
      }
    }

    if (posStrengths.length > 0 && userTeam) {
      contextParts.push(`\nUser's Positional Strengths (rank in league):`);
      posStrengths
        .filter((ps: any) => ps.team_id === userTeam.team_id)
        .sort((a: any, b: any) => a.rank - b.rank)
        .forEach((ps: any) => {
          const label = ps.rank <= Math.ceil(league.league_size / 3) ? 'strong' : ps.rank >= Math.floor(league.league_size * 2 / 3) ? 'weak — upgrade target' : 'average';
          contextParts.push(`  - ${ps.position}: Rank #${ps.rank}/${league.league_size} (${label})`);
        });
    }

    if (allTeams.length > 0 && userTeam) {
      contextParts.push(`\nOther Teams in League:`);
      allTeams
        .filter((t: any) => t.team_id !== userTeam.team_id)
        .forEach((t: any) => {
          contextParts.push(`  - ${t.team_name}: ${t.wins || 0}-${t.losses || 0}${t.ties ? `-${t.ties}` : ''}`);
        });
    }

    contextParts.push(`\nTop ${Math.min(topPlayers.length, 150)} Players by Trade Value:`);
    topPlayers.slice(0, 150).forEach((p: any, idx: number) => {
      contextParts.push(
        `${idx + 1}. ${p.player_name} (${p.position}, ${p.team || 'FA'}) - TV: ${p.trade_value?.toFixed(1)}, ROS PPG: ${p.meta_proj_ros_ppg?.toFixed(1) || 'N/A'}`
      );
    });

    const systemPrompt = `You are an expert fantasy football AI assistant for ${league.league_name}. You have full context about the user's team, roster, matchup, injury statuses, and league standings below.

CONTEXT:
${contextParts.join('\n')}

HOW TO ANSWER QUESTIONS:

Start/Sit questions → Call get_start_sit_data with the player names. Then give a clear recommendation:
- "Start [Player] — projected X.X pts vs [Opponent] (def rank #N). [Player] is averaging X.X over last 3 weeks."
- Flag any bye weeks or injury concerns from the context above before the user even asks.
- For close calls (<1 pt difference): say so and explain the tiebreaker.

Trade questions → Call get_trade_data with all players involved. Then:
- "Trade Verdict: Accept / Decline"
- Show each player's Trade Value (0-100 scale) and Proj ROS PPG (these are always different numbers)
- Side A Total vs Side B Total (sum of trade values)
- One sentence on who wins the trade and why (ROS value, positional need, depth)

Trade target questions → Call suggest_trade_targets. Format each suggestion as:
- "Trade [Your Player] for [Target] — upgrades your weak [Position] (#X/${league.league_size}), they need [Your Position] (#Y/${league.league_size})."

General roster advice → Use the context already provided. Reference specific players by name, their actual stats, injury status, and matchups. Never give generic advice when you have real data.

IMPORTANT RULES:
- Accept any player name format — fuzzy matching handles partial names
- Never say "I need more info" when the context above already has it
- Never use asterisks for formatting
- Week defaults to ${currentWeek} unless user specifies otherwise
- If a player is ON BYE or has a concerning injury status, proactively mention it
- Trade Value is 0-100 scale. PPG is 5-25. Never confuse them.`;

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
      },
      {
        type: "function",
        function: {
          name: "suggest_trade_targets",
          description: "Get AI-powered trade suggestions based on your team's strengths/weaknesses and league dynamics. Automatically identifies best trade targets and packages. Optionally filter by position to upgrade (QB, RB, WR, TE).",
          parameters: {
            type: "object",
            properties: {
              position: {
                type: "string",
                description: "Optional: Focus on upgrading a specific position (QB, RB, WR, TE)",
                enum: ["QB", "RB", "WR", "TE"]
              }
            },
            required: []
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
                } else if (funcName === 'suggest_trade_targets') {
                  // Call the backend function that does all the heavy analysis
                  const targetPos = args.position ? args.position.toUpperCase() : null;
                  
                  console.log('Calling suggest-trade-targets backend:', { leagueId, targetPos });
                  
                  const { data: suggestions, error: suggestError } = await supabase.functions.invoke(
                    'suggest-trade-targets',
                    {
                      body: { 
                        leagueId,
                        targetPosition: targetPos
                      },
                      headers: {
                        Authorization: authHeader,
                      }
                    }
                  );
                  
                  if (suggestError) {
                    console.error('Error from suggest-trade-targets:', suggestError);
                    toolResult = {
                      error: 'Failed to generate trade suggestions. Please try again.',
                      data_source: 'suggest-trade-targets'
                    };
                  } else if (!suggestions || suggestions.suggestions?.length === 0) {
                    toolResult = {
                      message: suggestions?.error || 'No matching trade suggestions found for this position right now.',
                      data_source: 'suggest-trade-targets'
                    };
                  } else {
                    // PRE-FORMAT the response here to bypass the second AI call truncation issue
                    const sug = suggestions.suggestions || [];
                    const targetPositions = suggestions.target_positions || [];
                    
                    let formattedResponse = `Here are my top trade recommendations:\n\n`;
                    
                    sug.forEach((s: any, idx: number) => {
                      const target = s.target_player;
                      const offer = s.offer_player;
                      const fit = s.strategic_fit || {};
                      const valueDiff = s.value_difference || 0;
                      
                      formattedResponse += `${idx + 1}. Trade ${offer.name} for ${target.name}\n`;
                      formattedResponse += `   You send: ${offer.name} (${offer.position}, TV: ${offer.trade_value})\n`;
                      formattedResponse += `   You get: ${target.name} (${target.position}, TV: ${target.trade_value})\n`;
                      
                      // Build why this trade makes sense
                      const reasons: string[] = [];
                      if (fit.improves_your_weakness) reasons.push(`upgrades your weak ${target.position} position`);
                      if (fit.addresses_their_weakness) reasons.push(`fills their ${offer.position} need`);
                      if (fit.trading_from_your_strength) reasons.push(`you have ${offer.position} depth`);
                      if (Math.abs(valueDiff) <= 5) reasons.push('fair value');
                      
                      if (reasons.length > 0) {
                        formattedResponse += `   Why: ${reasons.join(', ')}\n`;
                      }
                      formattedResponse += '\n';
                    });
                    
                    if (sug.length === 0) {
                      formattedResponse = `I couldn't find strong trade targets right now. Your roster may be well-balanced or there aren't clear upgrade opportunities in your league.`;
                    }
                    
                    // Store formatted response to stream directly
                    toolResult = {
                      __preformatted: true,
                      response: formattedResponse,
                      data_source: 'suggest-trade-targets'
                    };
                  }
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
            
            // Check if any tool result has preformatted response (skip second AI call)
            const preformattedResult = toolMessages.find(m => {
              try {
                const parsed = typeof m.content === 'string' ? JSON.parse(m.content) : m.content;
                return parsed.__preformatted === true;
              } catch {
                return false;
              }
            });
            
            if (preformattedResult) {
              // Stream preformatted response directly - no need for second AI call
              console.log('Streaming preformatted response directly');
              try {
                const parsed = typeof preformattedResult.content === 'string' 
                  ? JSON.parse(preformattedResult.content) 
                  : preformattedResult.content;
                fullContent = parsed.response || '';
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', content: fullContent })}\n\n`));
              } catch (e) {
                console.error('Error parsing preformatted response:', e);
                fullContent = 'I found some trade suggestions but had trouble formatting them. Please try again.';
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', content: fullContent })}\n\n`));
              }
            } else {
              // Make second AI call with tool results to get final answer
              console.log('Making second AI call with tool results');
              // Compact tool messages to avoid exceeding model input size limits
              const MAX_TOOL_TOTAL = 1500;
              const MAX_TOOL_PER = 800;
              const compactToolMessages = toolMessages.map((m) => {
                let c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
                if (c.length > MAX_TOOL_PER) c = c.slice(0, MAX_TOOL_PER) + '... [truncated]';
                return { ...m, content: c };
              });
              // Enforce total cap across all tool messages
              let running = 0;
              for (const m of compactToolMessages) {
                if (running >= MAX_TOOL_TOTAL) {
                  m.content = '';
                  continue;
                }
                if (running + m.content.length > MAX_TOOL_TOTAL) {
                  m.content = m.content.slice(0, MAX_TOOL_TOTAL - running) + '...';
                  running = MAX_TOOL_TOTAL;
                } else {
                  running += m.content.length;
                }
              }
              const finalMessages = [
                { role: 'system', content: systemPrompt },
                ...messages,
                ...compactToolMessages
              ];
              console.log('Second call message count:', finalMessages.length);
              
              const secondAiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${lovableApiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: 'google/gemini-2.5-flash',
                  messages: finalMessages,
                  stream: true,
                }),
              });
              
              console.log('Second AI response status:', secondAiResponse.status);
              
              if (!secondAiResponse.ok) {
                const errorText = await secondAiResponse.text();
                console.error('Second AI call failed:', secondAiResponse.status, errorText);
                const errorMessage = 'Sorry, I had trouble generating a response after analyzing the data. Please try asking again.';
                fullContent = errorMessage;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', content: errorMessage })}\n\n`));
              } else {
                console.log('Second AI response OK, starting to read stream...');
                const secondReader = secondAiResponse.body?.getReader();
                let secondBuffer = '';
                let chunkCount = 0;
                let contentReceived = false;
                
                while (true) {
                  const { done, value } = await secondReader!.read();
                  if (done) {
                    console.log('Second AI stream done. Chunks received:', chunkCount, 'Content received:', contentReceived);
                    break;
                  }

                  chunkCount++;
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
                        contentReceived = true;
                        fullContent += delta.content;
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', content: delta.content })}\n\n`));
                      }
                    } catch (e) {
                      console.error('Error parsing second AI response:', e, 'Line:', line);
                    }
                  }
                }
                
                if (!contentReceived) {
                  console.error('No content received from second AI call!');
                  const fallbackMessage = 'I analyzed your league data but had trouble formatting the response. Let me try a different approach - can you be more specific about which position you want to upgrade?';
                  fullContent = fallbackMessage;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', content: fallbackMessage })}\n\n`));
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
