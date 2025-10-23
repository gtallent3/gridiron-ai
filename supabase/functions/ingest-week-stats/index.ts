import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Main ingestion orchestrator
 * Ingestion order: ESPN boxscore → Sleeper/Yahoo actuals → Projections
 * 
 * POST /ingest-week-stats
 * Body: { week, season, leagueId?, force? }
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Authentication required');
    }

    const { week, season, leagueId, force = false } = await req.json();

    if (!week || !season) {
      throw new Error('Week and season are required');
    }

    console.log(`Starting ingestion for Week ${week}, Season ${season}`);

    // Step 1: Check if already ingested and finalized (unless force=true)
    if (!force) {
      const { data: existingStats, error: checkError } = await supabase
        .from('player_stats')
        .select('player_id, finalized')
        .eq('week', week)
        .eq('season', season)
        .eq('finalized', true)
        .limit(1);

      if (checkError) {
        console.error('Error checking existing stats:', checkError);
      } else if (existingStats && existingStats.length > 0) {
        console.log(`Week ${week} already finalized, skipping ingestion`);
        return new Response(
          JSON.stringify({ 
            message: `Week ${week} stats already finalized`,
            week,
            season,
            finalized: true
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Step 2: Get all leagues to process (or specific league if provided)
    let leaguesToProcess: any[] = [];
    if (leagueId) {
      const { data, error } = await supabase
        .from('connected_leagues')
        .select('*')
        .eq('id', leagueId)
        .single();
      if (error || !data) {
        throw new Error('League not found');
      }
      leaguesToProcess = [data];
    } else {
      const { data, error } = await supabase
        .from('connected_leagues')
        .select('*');
      if (error) {
        throw new Error('Failed to fetch leagues');
      }
      leaguesToProcess = data || [];
    }

    console.log(`Processing ${leaguesToProcess.length} league(s)`);

    // Step 3: Invoke ingestion for each platform
    const results: any[] = [];
    for (const league of leaguesToProcess) {
      try {
        if (league.platform === 'espn') {
          // Trigger ESPN boxscore sync (will be created next)
          console.log(`Triggering ESPN ingestion for league ${league.league_id}`);
          // TODO: Call espn-boxscore-sync function
          results.push({ league: league.league_id, platform: 'espn', status: 'pending' });
        } else if (league.platform === 'sleeper') {
          // Trigger Sleeper boxscore sync
          console.log(`Triggering Sleeper ingestion for league ${league.league_id}`);
          // TODO: Call sleeper-boxscore-sync function
          results.push({ league: league.league_id, platform: 'sleeper', status: 'pending' });
        }
      } catch (err) {
        console.error(`Error processing league ${league.league_id}:`, err);
        results.push({ league: league.league_id, error: String(err) });
      }
    }

    // Step 4: Trigger reconciliation after all sources are collected
    console.log('Triggering stat reconciliation...');
    // TODO: Call reconcile-stats function
    
    return new Response(
      JSON.stringify({
        message: `Ingestion started for week ${week}`,
        week,
        season,
        leagues_processed: leaguesToProcess.length,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Ingestion error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to ingest stats' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
