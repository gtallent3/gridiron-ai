import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Validate authorization: TASK_KEY for cron jobs OR authenticated admin user
  const taskKey = req.headers.get('x-task-key');
  const authHeader = req.headers.get('Authorization');
  let isAuthorized = false;

  if (taskKey && taskKey === Deno.env.get('TASK_KEY')) {
    isAuthorized = true;
  }

  if (!isAuthorized && authHeader) {
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (user) {
      const { data: roles } = await supabaseAuth.from('user_roles').select('role').eq('user_id', user.id);
      if (roles?.some(r => r.role === 'admin')) {
        isAuthorized = true;
      }
    }
  }

  if (!isAuthorized) {
    console.error('Unauthorized: Invalid TASK_KEY and not an admin user');
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Starting auto-ingestion for all connected leagues...');

    // Get all connected leagues with auto_refresh enabled
    const { data: leagues, error: leaguesError } = await supabase
      .from('connected_leagues')
      .select('id, league_name, platform')
      .eq('auto_refresh', true);

    if (leaguesError) {
      console.error('Error fetching leagues:', leaguesError);
      throw leaguesError;
    }

    console.log(`Found ${leagues?.length || 0} leagues to process`);

    const results = {
      total: leagues?.length || 0,
      successful: 0,
      failed: 0,
      errors: [] as string[],
    };

    // Process each league
    for (const league of leagues || []) {
      try {
        console.log(`Processing league: ${league.league_name} (${league.id})`);

        // Check if we need to fetch rosters (daily update)
        const { data: fetchMeta } = await supabase
          .from('fetch_metadata')
          .select('last_fetched_at')
          .eq('league_id', league.id)
          .eq('endpoint_type', 'rosters')
          .single();

        const lastRosterFetch = fetchMeta?.last_fetched_at;
        const hoursSinceLastFetch = lastRosterFetch 
          ? (Date.now() - new Date(lastRosterFetch).getTime()) / (1000 * 60 * 60)
          : 999;

        // Fetch rosters if more than 23 hours since last fetch
        if (hoursSinceLastFetch > 23) {
          const rostersResponse = await supabase.functions.invoke('ingest-roster-snapshots', {
            body: { leagueId: league.id },
          });

          if (rostersResponse.error) {
            console.warn(`Rosters warning for ${league.league_name}:`, rostersResponse.error.message);
          } else {
            console.log(`✓ Rosters ingested for ${league.league_name}`);
          }
        }

        results.successful++;

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Failed to process league ${league.league_name}:`, error);
        results.failed++;
        results.errors.push(`${league.league_name}: ${errorMessage}`);

        // Check error count and alert if threshold reached
        const { data: fetchMeta } = await supabase
          .from('fetch_metadata')
          .select('error_count')
          .eq('league_id', league.id)
          .eq('endpoint_type', 'transactions')
          .single();

        if (fetchMeta && fetchMeta.error_count >= 3) {
          console.warn(`⚠️ League ${league.league_name} has failed ${fetchMeta.error_count} times`);
          // TODO: Send alert via webhook or email
        }
      }
    }

    console.log('Auto-ingestion completed:', results);

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error in auto-ingest-all-leagues:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
