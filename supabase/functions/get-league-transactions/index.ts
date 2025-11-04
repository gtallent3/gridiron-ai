import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createErrorResponse } from "../_shared/errorHandler.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    // Get authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const url = new URL(req.url);
    const leagueId = url.searchParams.get('leagueId');
    const since = url.searchParams.get('since');
    const transactionType = url.searchParams.get('type');
    const limit = parseInt(url.searchParams.get('limit') || '100');

    if (!leagueId) {
      throw new Error('League ID is required');
    }

    // Verify user owns this league
    const { data: league, error: leagueError } = await supabase
      .from('connected_leagues')
      .select('id')
      .eq('id', leagueId)
      .eq('user_id', user.id)
      .single();

    if (leagueError || !league) {
      throw new Error('League not found or access denied');
    }

    // Build query
    let query = supabase
      .from('league_transactions')
      .select('*')
      .eq('league_id', leagueId)
      .order('transaction_date', { ascending: false })
      .limit(limit);

    // Apply filters
    if (since) {
      query = query.gte('transaction_date', since);
    }

    if (transactionType) {
      query = query.eq('transaction_type', transactionType);
    }

    const { data: transactions, error: txError } = await query;

    if (txError) {
      console.error('Error fetching transactions:', txError);
      throw txError;
    }

    // Get fetch metadata for this league
    const { data: fetchMeta } = await supabase
      .from('fetch_metadata')
      .select('*')
      .eq('league_id', leagueId)
      .eq('endpoint_type', 'transactions')
      .single();

    return new Response(
      JSON.stringify({
        success: true,
        count: transactions?.length || 0,
        transactions: transactions || [],
        metadata: {
          lastFetched: fetchMeta?.last_fetched_at,
          fetchCount: fetchMeta?.fetch_count,
          errorCount: fetchMeta?.error_count,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in get-league-transactions:', error);
    return createErrorResponse(error, 500, corsHeaders);
  }
});
