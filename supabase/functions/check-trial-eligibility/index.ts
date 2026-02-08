import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3?target=deno';
import { getCorsHeaders } from "../_shared/cors.ts";


interface TrialEligibilityCheck {
  user_id: string;
  phone?: string;
  payment_fingerprint?: string;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { user_id, phone, payment_fingerprint }: TrialEligibilityCheck = await req.json();

    const reasons: string[] = [];
    let eligible = true;

    // Check 1: Has this user already used a trial?
    const { data: userTokens } = await supabaseClient
      .from('user_tokens')
      .select('lifetime_purchased, subscription_expires_at')
      .eq('user_id', user_id)
      .maybeSingle();

    if (userTokens && (userTokens.lifetime_purchased > 0 || userTokens.subscription_expires_at)) {
      eligible = false;
      reasons.push('User has already made a purchase or used a subscription');
    }

    // Check 2: Phone number previously used for trial?
    if (phone && eligible) {
      const { data: phoneUsers } = await supabaseClient
        .from('app_users')
        .select('user_id')
        .eq('phone', phone)
        .neq('user_id', user_id);

      if (phoneUsers && phoneUsers.length > 0) {
        // Check if any of these users have used trials
        const { data: phoneTrials } = await supabaseClient
          .from('user_tokens')
          .select('user_id')
          .in(
            'user_id',
            phoneUsers.map((u) => u.user_id)
          )
          .or('lifetime_purchased.gt.0,subscription_expires_at.not.is.null');

        if (phoneTrials && phoneTrials.length > 0) {
          eligible = false;
          reasons.push('Phone number previously used for trial/subscription');
        }
      }
    }

    // Check 3: Payment fingerprint previously used for trial?
    if (payment_fingerprint && eligible) {
      const { data: fingerprintUsers } = await supabaseClient
        .from('payment_fingerprints')
        .select('user_id')
        .eq('fingerprint', payment_fingerprint)
        .neq('user_id', user_id);

      if (fingerprintUsers && fingerprintUsers.length > 0) {
        const { data: fingerprintTrials } = await supabaseClient
          .from('user_tokens')
          .select('user_id')
          .in(
            'user_id',
            fingerprintUsers.map((u) => u.user_id)
          )
          .or('lifetime_purchased.gt.0,subscription_expires_at.not.is.null');

        if (fingerprintTrials && fingerprintTrials.length > 0) {
          eligible = false;
          reasons.push('Payment method previously used for trial/subscription');
        }
      }
    }

    // Log the eligibility check
    await supabaseClient.from('risk_events').insert({
      user_id,
      event_type: 'trial_eligibility_check',
      risk_score: eligible ? 0 : 50,
      reason: eligible ? 'Trial eligible' : reasons.join(', '),
      meta: {
        phone: phone ? '***' + phone.slice(-4) : null,
        payment_fingerprint: payment_fingerprint ? payment_fingerprint.slice(0, 8) + '...' : null,
        eligible,
      },
    });

    console.log('Trial eligibility check:', {
      user_id,
      eligible,
      reasons: reasons.length > 0 ? reasons : ['Eligible for trial'],
    });

    return new Response(
      JSON.stringify({
        eligible,
        reasons: eligible ? ['Eligible for free trial'] : reasons,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in check-trial-eligibility:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});