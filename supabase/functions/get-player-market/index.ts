import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";
import { getCorsHeaders } from "../_shared/cors.ts";


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const url = new URL(req.url);
    const season = parseInt(url.searchParams.get('season') || '2024');
    const week = parseInt(url.searchParams.get('week') || '1');
    const position = url.searchParams.get('position') || null;
    const status = url.searchParams.get('status') || null; // ROSTERED, FREEAGENT, WAIVERS
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const sortBy = url.searchParams.get('sortBy') || 'projected_fp'; // projected_fp, percent_owned

    console.log(`Fetching player market: Season ${season}, Week ${week}, Position ${position}, Status ${status}`);

    // Try to get actuals from actual_weekly_points
    let query = supabase
      .from('actual_weekly_points')
      .select('*')
      .eq('season', season)
      .eq('week', week);

    if (position) {
      query = query.eq('position', position);
    }

    const { data: actuals, error: actualsError } = await query.limit(limit);

    // Get projections to fill gaps
    let projQuery = supabase
      .from('projected_player_stats')
      .select('*')
      .eq('season', season)
      .eq('week', week);

    if (position) {
      projQuery = projQuery.eq('position', position);
    }
    if (status) {
      projQuery = projQuery.eq('waiver_status', status);
    }

    const { data: projections, error: projError } = await projQuery
      .order(sortBy, { ascending: false })
      .limit(limit);

    if (projError) {
      throw projError;
    }

    // Merge actuals and projections, preferring actuals
    const actualPlayerIds = new Set((actuals || []).map(a => a.player_id));
    const mergedData = [
      ...(actuals || []).map(a => ({
        ...a,
        source_type: 'actual',
        provenance: a.source || 'espn_actual',
      })),
      ...(projections || [])
        .filter(p => !actualPlayerIds.has(p.player_id))
        .map(p => ({
          ...p,
          source_type: 'projection',
          provenance: p.source || 'espn_projection',
        }))
    ];

    // Sort by requested field
    mergedData.sort((a, b) => {
      if (sortBy === 'projected_fp') {
        return (b.projected_fp || 0) - (a.projected_fp || 0);
      }
      if (sortBy === 'percent_owned') {
        return (b.percent_owned || 0) - (a.percent_owned || 0);
      }
      return 0;
    });

    const limitedData = mergedData.slice(0, limit);

    return new Response(
      JSON.stringify({
        success: true,
        season,
        week,
        count: limitedData.length,
        players: limitedData,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in get-player-market:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
