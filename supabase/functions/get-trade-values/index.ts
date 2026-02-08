import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";
import { createErrorResponse } from "../_shared/errorHandler.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const url = new URL(req.url);
    const date = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
    const position = url.searchParams.get('position');
    const team = url.searchParams.get('team');
    const playerName = url.searchParams.get('player');
    const source = url.searchParams.get('source') || 'fantasycalc_redraft';

    // Build query
    let query = supabase
      .from('trade_values')
      .select('*')
      .eq('source', source)
      .eq('snapshot_date', date)
      .order('rank', { ascending: true });

    // Apply filters
    if (position) {
      query = query.eq('position', position.toUpperCase());
    }
    if (team) {
      query = query.eq('team', team.toUpperCase());
    }
    if (playerName) {
      query = query.ilike('player_name', `%${playerName}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching trade values:', error);
      return createErrorResponse(error, 500, corsHeaders);
    }

    return new Response(
      JSON.stringify({
        success: true,
        count: data?.length || 0,
        snapshot_date: date,
        source: source,
        data: data || []
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in get-trade-values:', error);
    return createErrorResponse(error, 500, corsHeaders);
  }
});
