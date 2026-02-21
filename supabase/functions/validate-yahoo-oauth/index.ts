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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return createErrorResponse('Missing authorization header', 401, corsHeaders);
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      console.error('Auth error:', userError);
      return createErrorResponse('Unauthorized', 401, corsHeaders);
    }

    const { code, redirectUri: bodyRedirectUri } = await req.json();

    if (!code) {
      return createErrorResponse('Missing OAuth code', 400, corsHeaders);
    }

    console.log('Exchanging OAuth code for access token...');

    // Exchange code for access token
    const clientId = Deno.env.get('YAHOO_CLIENT_ID')!;
    const clientSecret = Deno.env.get('YAHOO_CLIENT_SECRET')!;
    const redirectUri = bodyRedirectUri || `${req.headers.get('origin')}/connect-league`;

    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code: code,
    });

    const authString = btoa(`${clientId}:${clientSecret}`);
    const tokenResponse = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authString}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams,
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', errorText);
      return createErrorResponse('Failed to exchange OAuth code', 400, corsHeaders);
    }

    const tokenData = await tokenResponse.json();
    console.log('Successfully obtained access token');

    // Get user's fantasy games to find NFL leagues (including leagues in the response)
    const gamesResponse = await fetch(
      'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl/leagues?format=json',
      {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
        },
      }
    );

    if (!gamesResponse.ok) {
      console.error('Failed to fetch NFL games and leagues');
      return createErrorResponse('Failed to fetch Yahoo fantasy games', 400, corsHeaders);
    }

    const gamesData = await gamesResponse.json();
    console.log('Successfully fetched NFL games and leagues');

    // Store token data securely (expires_in is in seconds from now)
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    return new Response(
      JSON.stringify({
        success: true,
        tokenData: {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: expiresAt.toISOString(),
        },
        gamesData,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in validate-yahoo-oauth:', error);
    return createErrorResponse(error, 500, corsHeaders);
  }
});
