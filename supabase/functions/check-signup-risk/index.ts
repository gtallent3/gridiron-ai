import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SignupRiskCheck {
  email: string;
  phone?: string;
  provider: string;
  provider_uid: string;
  fingerprint: string;
  ip: string;
  userAgent?: string;
}

interface RiskResult {
  allowed: boolean;
  risk_score: number;
  reasons: string[];
  requires_verification?: boolean;
  blocked?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const payload: SignupRiskCheck = await req.json();
    const { email, phone, provider, provider_uid, fingerprint, ip, userAgent } = payload;

    // Normalize email
    const { data: normalizedData } = await supabase.rpc('normalize_email', { raw_email: email });
    const normalizedEmail = normalizedData || email.toLowerCase().trim();

    let riskScore = 0;
    const reasons: string[] = [];

    // Check 1: Email collision
    const { data: existingEmail } = await supabase
      .from('app_users')
      .select('user_id, is_banned')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingEmail) {
      if (existingEmail.is_banned) {
        return new Response(
          JSON.stringify({
            allowed: false,
            blocked: true,
            risk_score: 100,
            reasons: ['Account banned'],
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
        );
      }
      riskScore += 50;
      reasons.push('Email already registered');
    }

    // Check 2: Phone collision
    if (phone) {
      const { data: existingPhone } = await supabase
        .from('app_users')
        .select('user_id')
        .eq('phone', phone)
        .maybeSingle();

      if (existingPhone) {
        riskScore += 50;
        reasons.push('Phone already registered');
      }
    }

    // Check 3: Provider UID collision
    const { data: existingProviderUid } = await supabase
      .from('user_identities')
      .select('user_id')
      .eq('provider', provider)
      .eq('provider_uid', provider_uid)
      .maybeSingle();

    if (existingProviderUid) {
      riskScore += 25;
      reasons.push('Provider identity already linked');
    }

    // Check 4: Device fingerprint - count unique users with same fingerprint in last 30 days
    const { data: deviceUsers, error: deviceError } = await supabase
      .from('devices')
      .select('user_id')
      .eq('fingerprint', fingerprint)
      .gte('last_seen', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    if (deviceUsers && deviceUsers.length >= 2) {
      riskScore += 20;
      reasons.push(`Device fingerprint linked to ${deviceUsers.length} accounts`);
    }

    // Check 5: IP rate limiting - count signups from this IP in last 24h
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    // Get or create rate limit record
    const { data: rateLimit } = await supabase
      .from('signup_rate_limits')
      .select('*')
      .eq('identifier', ip)
      .eq('identifier_type', 'ip')
      .gte('window_start', windowStart.toISOString())
      .maybeSingle();

    const ipCount = rateLimit ? rateLimit.attempt_count : 0;

    if (ipCount >= 5) {
      riskScore += 30;
      reasons.push(`High signup velocity from IP (${ipCount} signups in 24h)`);
    } else if (ipCount >= 3) {
      riskScore += 15;
      reasons.push(`Moderate signup velocity from IP (${ipCount} signups in 24h)`);
    }

    // Increment rate limit counter
    if (rateLimit) {
      await supabase
        .from('signup_rate_limits')
        .update({ attempt_count: rateLimit.attempt_count + 1 })
        .eq('id', rateLimit.id);
    } else {
      await supabase
        .from('signup_rate_limits')
        .insert({
          identifier: ip,
          identifier_type: 'ip',
          attempt_count: 1,
          window_start: new Date().toISOString(),
        });
    }

    // Check 6: OAuth providers get trust bonus
    if (provider === 'google' || provider === 'apple') {
      riskScore = Math.max(0, riskScore - 15);
      reasons.push('OAuth provider bonus applied');
    }

    // Determine action based on risk score
    let result: RiskResult;

    if (riskScore >= 70) {
      // Hard block
      result = {
        allowed: false,
        blocked: true,
        risk_score: riskScore,
        reasons,
      };
    } else if (riskScore >= 50) {
      // Soft block - require additional verification
      result = {
        allowed: false,
        requires_verification: true,
        risk_score: riskScore,
        reasons,
      };
    } else {
      // Allow
      result = {
        allowed: true,
        risk_score: riskScore,
        reasons,
      };
    }

    // Hash sensitive data for privacy compliance
    const hashData = async (data: string): Promise<string> => {
      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(data);
      const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    };

    const emailDomain = normalizedEmail.split('@')[1] || '';
    const hashedEmail = await hashData(normalizedEmail);
    const hashedIp = await hashData(ip);

    // Log risk event (for monitoring) with hashed PII
    await supabase.from('risk_events').insert({
      event_type: 'signup_attempt',
      risk_score: riskScore,
      reason: reasons.join(', '),
      meta: {
        email_hash: hashedEmail,
        email_domain: emailDomain, // Store domain only for analysis
        provider,
        fingerprint, // Already a hash
        ip_hash: hashedIp,
        result: result.allowed ? 'allowed' : result.blocked ? 'blocked' : 'verification_required',
      },
    });

    console.log('Signup risk check:', {
      email_domain: emailDomain,
      risk_score: riskScore,
      result: result.allowed ? 'allowed' : result.blocked ? 'blocked' : 'verification_required',
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: result.blocked ? 403 : 200,
    });
  } catch (error) {
    console.error('Error in check-signup-risk:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});