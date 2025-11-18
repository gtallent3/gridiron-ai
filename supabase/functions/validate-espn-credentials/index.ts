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

  try {
    const { swid, espn_s2, leagueId } = await req.json();

    // Validate inputs
    if (!swid || !espn_s2 || !leagueId) {
      return new Response(
        JSON.stringify({ error: 'Missing required credentials' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Test ESPN API connection
    console.log('Testing ESPN API connection...');
    
    // Ensure SWID is wrapped in braces for cookie format
    const swidCookie = swid.startsWith('{') ? swid : `{${swid}}`;
    
    const testResponse = await fetch(
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2025/segments/0/leagues/${leagueId}?view=mSettings`,
      {
        headers: {
          'Cookie': `SWID=${swidCookie}; espn_s2=${espn_s2}`,
        },
      }
    );

    if (!testResponse.ok) {
      console.error('ESPN API test failed:', testResponse.status);
      return new Response(
        JSON.stringify({ 
          error: 'Invalid ESPN credentials or league ID',
          details: 'Could not authenticate with ESPN API'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const leagueData = await testResponse.json();
    console.log('ESPN API connection successful');

    // Simple encryption (in production, use proper encryption library)
    // For now, we'll store as-is since it's in a secure table
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Store credentials with 90-day expiration
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    const { error: storeError } = await supabaseAdmin
      .from('espn_credentials')
      .upsert({
        user_id: user.id,
        league_id: leagueId,
        swid_encrypted: swid,
        espn_s2_encrypted: espn_s2,
        expires_at: expiresAt.toISOString(),
        last_synced_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,league_id'
      });

    if (storeError) {
      console.error('Error storing credentials:', storeError);
      return new Response(
        JSON.stringify({ error: 'Failed to store credentials' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        leagueName: leagueData.settings?.name || 'ESPN League',
        expiresAt: expiresAt.toISOString()
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Validation error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});