import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Transaction {
  id: string;
  date: number;
  type: string;
  teams: Array<{ teamId: number }>;
  items?: Array<{ 
    playerId: number; 
    type: string; 
    fromTeamId?: number; 
    toTeamId?: number;
  }>;
  bidAmount?: number;
  comments?: string;
}

interface Player {
  id: number;
  fullName: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { leagueId } = await req.json();

    if (!leagueId) {
      throw new Error('League ID is required');
    }

    // Get league info
    const { data: league, error: leagueError } = await supabase
      .from('connected_leagues')
      .select('*')
      .eq('id', leagueId)
      .single();

    if (leagueError) throw leagueError;

    // Get last fetch time
    const { data: fetchMeta } = await supabase
      .from('fetch_metadata')
      .select('last_fetched_at, fetch_count')
      .eq('league_id', leagueId)
      .eq('endpoint_type', 'transactions')
      .single();

    const lastFetchTime = fetchMeta?.last_fetched_at || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    
    // Get ESPN credentials
    const { data: credentials } = await supabase
      .from('espn_credentials')
      .select('*')
      .eq('user_id', league.user_id)
      .eq('league_id', league.league_id)
      .single();

    if (!credentials) {
      throw new Error('ESPN credentials not found');
    }

    // Fetch transactions and player data from ESPN
    const espnUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2024/segments/0/leagues/${league.league_id}?view=mTransactions2&view=players_wl`;
    
    const espnResponse = await fetch(espnUrl, {
      headers: {
        'Cookie': `swid=${credentials.swid_encrypted}; espn_s2=${credentials.espn_s2_encrypted}`,
      },
    });

    if (!espnResponse.ok) {
      throw new Error(`ESPN API error: ${espnResponse.statusText}`);
    }

    const espnData = await espnResponse.json();
    const transactions: Transaction[] = espnData.transactions || [];
    const players = espnData.players || [];
    
    // Create player ID to name mapping
    const playerMap = new Map<number, string>();
    players.forEach((p: any) => {
      if (p.player) {
        playerMap.set(p.player.id, p.player.fullName);
      }
    });

    console.log(`Found ${transactions.length} transactions for league ${leagueId}`);

    // Filter transactions since last fetch
    const newTransactions = transactions.filter(t => 
      new Date(t.date).getTime() > new Date(lastFetchTime).getTime()
    );

    console.log(`Processing ${newTransactions.length} new transactions`);

    // Normalize and insert transactions
    const normalizedTransactions = newTransactions.map(t => {
      const transactionType = t.type === 'TRADE' ? 'trade' : 
                             t.type === 'WAIVER' ? 'waiver' :
                             t.type === 'FREEAGENT' ? 'add' : 'drop';

      const teamsInvolved = t.teams?.map(team => ({
        teamId: team.teamId,
      })) || [];

      const playersInvolved = t.items?.map(item => ({
        playerId: item.playerId,
        type: item.type,
        fromTeamId: item.fromTeamId,
        toTeamId: item.toTeamId,
      })) || [];

      // Extract trade partner (for trades, find the other team)
      let tradePartner = null;
      if (transactionType === 'trade' && teamsInvolved.length === 2) {
        tradePartner = teamsInvolved.map(team => team.teamId.toString()).join(',');
      }

      // Get player names
      const playerNames = playersInvolved
        .map(p => playerMap.get(p.playerId))
        .filter(name => name) as string[];

      return {
        league_id: leagueId,
        transaction_date: new Date(t.date).toISOString(),
        transaction_type: transactionType,
        teams_involved: teamsInvolved,
        players_involved: playersInvolved,
        trade_partner: tradePartner,
        faab_spent: t.bidAmount || null,
        comments: t.comments || null,
        player_names: playerNames,
        raw_data: t,
        external_transaction_id: t.id,
      };
    });

    // Batch insert transactions
    if (normalizedTransactions.length > 0) {
      const { error: insertError } = await supabase
        .from('league_transactions')
        .upsert(normalizedTransactions, {
          onConflict: 'external_transaction_id',
          ignoreDuplicates: false,
        });

      if (insertError) {
        console.error('Error inserting transactions:', insertError);
        throw insertError;
      }
    }

    // Update fetch metadata
    await supabase
      .from('fetch_metadata')
      .upsert({
        league_id: leagueId,
        endpoint_type: 'transactions',
        last_fetched_at: new Date().toISOString(),
        fetch_count: (fetchMeta?.fetch_count || 0) + 1,
        error_count: 0,
        last_error: null,
      }, {
        onConflict: 'league_id,endpoint_type',
      });

    return new Response(
      JSON.stringify({
        success: true,
        transactionsProcessed: normalizedTransactions.length,
        lastFetchTime,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error in ingest-league-transactions:', error);
    
    // Update error count
    const { leagueId } = await req.json().catch(() => ({ leagueId: null }));
    if (leagueId) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      
      const { data: fetchMeta } = await supabase
        .from('fetch_metadata')
        .select('error_count')
        .eq('league_id', leagueId)
        .eq('endpoint_type', 'transactions')
        .single();

      await supabase
        .from('fetch_metadata')
        .upsert({
          league_id: leagueId,
          endpoint_type: 'transactions',
          last_fetched_at: new Date().toISOString(),
          error_count: (fetchMeta?.error_count || 0) + 1,
          last_error: errorMessage,
        }, {
          onConflict: 'league_id,endpoint_type',
        });
    }

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
