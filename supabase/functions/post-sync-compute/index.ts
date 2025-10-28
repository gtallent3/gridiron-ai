import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Post-sync compute function
 * Automatically computes player values and positional strengths after league data sync
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { leagueId } = await req.json();

    if (!leagueId) {
      return new Response(JSON.stringify({ error: 'leagueId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Starting post-sync compute for league ${leagueId}`);

    // Step 1: Compute player values
    const { data: valuesData, error: valuesError } = await supabase.functions.invoke(
      'compute-player-values',
      {
        body: { leagueId },
        headers: { Authorization: req.headers.get('Authorization')! },
      }
    );

    if (valuesError) {
      console.error('Error computing player values:', valuesError);
      throw new Error(`Failed to compute player values: ${valuesError.message}`);
    }

    console.log(`Player values computed: ${valuesData?.playersProcessed || 0} players`);

    // Step 2: Compute positional strengths (depends on player values)
    const { data: strengthsData, error: strengthsError } = await supabase.functions.invoke(
      'compute-positional-strengths',
      {
        body: { leagueId },
        headers: { Authorization: req.headers.get('Authorization')! },
      }
    );

    if (strengthsError) {
      console.error('Error computing positional strengths:', strengthsError);
      throw new Error(`Failed to compute positional strengths: ${strengthsError.message}`);
    }

    console.log(`Positional strengths computed: ${strengthsData?.teamsProcessed || 0} teams`);

    return new Response(
      JSON.stringify({
        success: true,
        playerValues: {
          playersProcessed: valuesData?.playersProcessed || 0,
        },
        positionalStrengths: {
          teamsProcessed: strengthsData?.teamsProcessed || 0,
        },
        message: 'Post-sync compute completed successfully',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in post-sync compute:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
