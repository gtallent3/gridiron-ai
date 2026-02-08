import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3?target=deno';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { getCorsHeaders } from "../_shared/cors.ts";


const signupSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(6).max(72),
  username: z.string().trim().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/),
  fingerprint: z.string().min(1),
});

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse and validate request body
    const body = await req.json();
    const validationResult = signupSchema.safeParse(body);
    
    if (!validationResult.success) {
      return new Response(
        JSON.stringify({ 
          error: 'Validation failed',
          details: validationResult.error.errors[0].message 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { email, password, username, fingerprint } = validationResult.data;

    // Capture real client IP from request headers
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim() 
      || req.headers.get('x-real-ip')
      || 'unknown';

    console.log('Signup attempt from IP:', clientIp);

    // Perform signup risk check with real IP
    const { data: riskCheck, error: riskError } = await supabase.functions.invoke('check-signup-risk', {
      body: {
        email,
        provider: 'email',
        provider_uid: email,
        fingerprint,
        ip: clientIp,
      },
    });

    if (riskError) {
      console.error('Risk check error:', riskError);
      return new Response(
        JSON.stringify({ error: 'Unable to verify signup request' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (riskCheck?.blocked) {
      return new Response(
        JSON.stringify({
          error: 'signup_blocked',
          message: riskCheck.reasons?.[0] || 'Account creation blocked for security reasons',
          blocked: true
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (riskCheck?.requires_verification) {
      return new Response(
        JSON.stringify({
          error: 'verification_required',
          message: 'Additional verification required',
          requires_verification: true
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if username already exists
    const { data: existingUser } = await supabase
      .from('profiles')
      .select('username')
      .eq('username', username)
      .maybeSingle();

    if (existingUser) {
      return new Response(
        JSON.stringify({ 
          error: 'username_taken',
          message: 'This username is already in use' 
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create the user account
    const { data: authData, error: signupError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm for non-production
      user_metadata: {
        username,
      },
    });

    if (signupError) {
      console.error('Signup error:', signupError);
      return new Response(
        JSON.stringify({ error: 'Unable to create account' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!authData?.user) {
      return new Response(
        JSON.stringify({ error: 'Account creation failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Link user identity with real IP
    const { error: linkError } = await supabase.functions.invoke('link-user-identity', {
      body: {
        user_id: authData.user.id,
        email,
        provider: 'email',
        provider_uid: email,
        fingerprint,
        ip: clientIp,
        userAgent: req.headers.get('user-agent') || undefined,
      },
    });

    if (linkError) {
      console.error('Identity linking error:', linkError);
      // Don't fail the signup if linking fails
    }

    console.log('Successful signup:', { userId: authData.user.id, email, ip: clientIp });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Account created successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in handle-signup:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    // Sanitize error message
    let clientMessage = 'An error occurred during signup';
    if (errorMessage.toLowerCase().includes('rate limit')) {
      clientMessage = 'Too many signup attempts. Please try again later.';
    }
    
    return new Response(
      JSON.stringify({ error: clientMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
