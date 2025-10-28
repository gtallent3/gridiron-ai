import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Message {
  role: string;
  content: string;
}

interface LeagueContext {
  leagueId: string;
  leagueName: string;
  platform: string;
  teamId: string;
  teamName: string;
  week: number;
  scoringType: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { message, conversationHistory, context } = await req.json() as {
      message: string;
      conversationHistory: Message[];
      context: LeagueContext;
    };

    console.log('Copilot request:', { message, context });

    // Determine intent
    const intent = classifyIntent(message);
    console.log('Classified intent:', intent);

    let response = '';
    let metadata: any = {};

    switch (intent) {
      case 'lineup':
        const lineupResult = await handleLineupOptimization(supabase, context, message);
        response = lineupResult.response;
        metadata = { type: 'lineup', data: lineupResult.data };
        break;

      case 'trade':
        const tradeResult = await handleTradeQuery(supabase, context, message);
        response = tradeResult.response;
        metadata = { type: 'trade', data: tradeResult.data };
        break;

      case 'waiver':
        const waiverResult = await handleWaiverQuery(supabase, context, message);
        response = waiverResult.response;
        metadata = { type: 'waiver', data: waiverResult.data };
        break;

      case 'injury':
        const injuryResult = await handleInjuryQuery(supabase, context);
        response = injuryResult.response;
        metadata = { type: 'injury', data: injuryResult.data };
        break;

      case 'matchup':
        const matchupResult = await handleMatchupQuery(supabase, context);
        response = matchupResult.response;
        metadata = { type: 'matchup', data: matchupResult.data };
        break;

      case 'schedule':
        const scheduleResult = await handleScheduleQuery(supabase, context);
        response = scheduleResult.response;
        metadata = { type: 'schedule', data: scheduleResult.data };
        break;

      default:
        response = await handleGeneralQuery(message, conversationHistory, context);
    }

    return new Response(
      JSON.stringify({ response, metadata }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Copilot error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function classifyIntent(message: string): string {
  const lower = message.toLowerCase();
  
  if (lower.match(/lineup|start|sit|bench|flex|optimize|who should i (start|play)/)) {
    return 'lineup';
  }
  if (lower.match(/trade|swap|exchange|improve.*(position|rb|wr|qb|te)/)) {
    return 'trade';
  }
  if (lower.match(/waiver|free agent|pickup|add|drop|faab/)) {
    return 'waiver';
  }
  if (lower.match(/injur|hurt|questionable|out|snap|status/)) {
    return 'injury';
  }
  if (lower.match(/matchup|opponent|this week|win probability/)) {
    return 'matchup';
  }
  if (lower.match(/schedule|playoff|strength of schedule|sos|ros/)) {
    return 'schedule';
  }
  
  return 'general';
}

async function handleLineupOptimization(supabase: any, context: LeagueContext, message: string) {
  try {
    // Try to extract a pairwise start/sit question like:
    // "Start Player A or Player B?" or "Player A vs Player B"
    const pairRegexes = [
      /start\s+([^?]+?)\s+(?:or|vs\.?|versus)\s+([^?]+?)(?:\?|$)/i,
      /([^?]+?)\s+(?:or|vs\.?|versus)\s+([^?]+?)(?:\?|$)/i,
    ];
    let p1: string | undefined;
    let p2: string | undefined;
    for (const rx of pairRegexes) {
      const m = message.match(rx);
      if (m) {
        p1 = m[1].trim();
        p2 = m[2].trim();
        break;
      }
    }

    if (p1 && p2) {
      const season = new Date().getFullYear();
      const week = context.week || 1;

      const { data, error } = await supabase.functions.invoke('analyze-start-sit', {
        body: {
          player1Name: p1,
          player2Name: p2,
          week,
          season,
        }
      });

      if (error) throw error;

      let response = `**Start/Sit: ${p1} vs ${p2} (Week ${week})**\n\n`;
      response += `Recommendation: ${data.recommendation}\n`;
      response += `Reason: ${data.reasoning}\n`;
      response += `Confidence: ${data.confidence}%`;

      return { response, data };
    }

    // No pairwise players detected – guide the user instead of erroring
    return {
      response: "I can compare two players for you. Try: 'Start Player A or Player B?' For full lineup optimization, use the My Team tab or ask position-specific questions (e.g., 'Best WR starters this week?').",
      data: null
    };
  } catch (error) {
    console.error('Lineup optimization error:', error);
    return {
      response: "I had trouble analyzing your lineup. Please try again.",
      data: null
    };
  }
}

async function handleTradeQuery(supabase: any, context: LeagueContext, message: string) {
  const lower = message.toLowerCase();
  
  // Check if looking to improve a position
  const positions = ['qb', 'rb', 'wr', 'te'];
  const targetPos = positions.find(pos => lower.includes(pos));
  
  if (targetPos) {
    try {
      const { data, error } = await supabase.functions.invoke('improve-position', {
        body: {
          leagueId: context.leagueId,
          teamId: context.teamId,
          position: targetPos.toUpperCase(),
        }
      });

      if (error) throw error;

      const trades = data.trades || [];
      if (trades.length === 0) {
        return {
          response: `No strong trade opportunities found to improve your ${targetPos.toUpperCase()} position right now.`,
          data: null
        };
      }

      let response = `**Trade Opportunities to Improve ${targetPos.toUpperCase()}**\n\n`;
      trades.slice(0, 3).forEach((trade: any, idx: number) => {
        response += `**Option ${idx + 1}** (Grade: ${trade.grade})\n`;
        response += `Give: ${trade.myPlayers.map((p: any) => p.name).join(', ')}\n`;
        response += `Get: ${trade.theirPlayers.map((p: any) => p.name).join(', ')}\n`;
        response += `Net Value: ${trade.net_value_gain > 0 ? '+' : ''}${trade.net_value_gain.toFixed(1)} ROS points\n`;
        response += `Acceptance: ${trade.acceptance_likelihood}\n\n`;
      });

      return { response, data: trades };
    } catch (error) {
      console.error('Trade find error:', error);
    }
  }

  return {
    response: "To find trade opportunities, specify a position you'd like to improve (e.g., 'Find trades to improve my RB').",
    data: null
  };
}

async function handleWaiverQuery(supabase: any, context: LeagueContext, message: string) {
  try {
    // Fetch waiver wire players
    const { data: waivers, error } = await supabase
      .from('waiver_wire_players')
      .select('*')
      .eq('league_id', context.leagueId)
      .eq('week', context.week)
      .order('projected_fp', { ascending: false })
      .limit(10);

    if (error) throw error;

    if (!waivers || waivers.length === 0) {
      return {
        response: "No waiver wire data available for your league yet.",
        data: null
      };
    }

    let response = `**Top Waiver Wire Targets for Week ${context.week}**\n\n`;
    waivers.slice(0, 5).forEach((player: any, idx: number) => {
      response += `${idx + 1}. **${player.player_name}** (${player.position}) - ${player.team}\n`;
      response += `   • Projected: ${player.projected_fp?.toFixed(1) || 'N/A'} pts\n`;
      response += `   • Owned: ${player.percent_owned?.toFixed(1) || 0}%\n`;
      response += `   • FAAB: 5-12% suggested\n\n`;
    });

    return { response, data: waivers };
  } catch (error) {
    console.error('Waiver query error:', error);
    return {
      response: "I had trouble fetching waiver wire data. Please try again.",
      data: null
    };
  }
}

async function handleInjuryQuery(supabase: any, context: LeagueContext) {
  try {
    // Fetch user's roster
    const { data: team, error } = await supabase
      .from('user_teams')
      .select('roster')
      .eq('league_id', context.leagueId)
      .eq('team_id', context.teamId)
      .single();

    if (error) throw error;

    const roster = team.roster || [];
    const injuryConcerns = roster.filter((p: any) => 
      p.injury_status && ['Q', 'D', 'O', 'IR'].includes(p.injury_status)
    );

    if (injuryConcerns.length === 0) {
      return {
        response: "Good news! No injury concerns on your roster right now.",
        data: null
      };
    }

    let response = `**Injury Report for ${context.teamName}**\n\n`;
    injuryConcerns.forEach((player: any) => {
      const status = player.injury_status === 'Q' ? 'Questionable' :
                     player.injury_status === 'D' ? 'Doubtful' :
                     player.injury_status === 'O' ? 'Out' : 'IR';
      response += `• **${player.name}** (${player.position}) - ${status}\n`;
    });

    return { response, data: injuryConcerns };
  } catch (error) {
    console.error('Injury query error:', error);
    return {
      response: "I had trouble checking injury statuses. Please try again.",
      data: null
    };
  }
}

async function handleMatchupQuery(supabase: any, context: LeagueContext) {
  return {
    response: `**Matchup Analysis for Week ${context.week}**\n\nMatchup analysis is coming soon! For now, check your lineup optimization and player projections.`,
    data: null
  };
}

async function handleScheduleQuery(supabase: any, context: LeagueContext) {
  return {
    response: `**Schedule Strength Analysis**\n\nSchedule and playoff analysis is coming soon! Focus on week-to-week optimizations for now.`,
    data: null
  };
}

async function handleGeneralQuery(message: string, history: Message[], context: LeagueContext) {
  return `I'm your Fantasy Copilot for **${context.leagueName}**. I can help you with:\n\n` +
    `• **Lineup optimization** - "Optimize my lineup"\n` +
    `• **Trade analysis** - "Find trades to improve my RB"\n` +
    `• **Waiver targets** - "Show waiver wire pickups"\n` +
    `• **Injury updates** - "Check my injury report"\n\n` +
    `What would you like help with?`;
}
