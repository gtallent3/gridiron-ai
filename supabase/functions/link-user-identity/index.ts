import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3?target=deno';
import { getCorsHeaders } from "../_shared/cors.ts";


interface LinkIdentityPayload {
  user_id: string;
  email: string;
  phone?: string;
  provider: string;
  provider_uid: string;
  stripe_customer_id?: string;
  fingerprint: string;
  ip: string;
  userAgent?: string;
}

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

    const payload: LinkIdentityPayload = await req.json();
    const {
      user_id,
      email,
      phone,
      provider,
      provider_uid,
      stripe_customer_id,
      fingerprint,
      ip,
      userAgent,
    } = payload;

    // Normalize email
    const { data: normalizedData } = await supabase.rpc('normalize_email', { raw_email: email });
    const normalizedEmail = normalizedData || email.toLowerCase().trim();

    // Step 1: Upsert app_users
    const { error: appUserError } = await supabase.from('app_users').upsert(
      {
        user_id,
        email: normalizedEmail,
        phone,
        stripe_customer_id,
        auth_provider: provider,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

    if (appUserError) {
      console.error('Error upserting app_users:', appUserError);
      throw appUserError;
    }

    // Step 2: Insert user_identity
    const { error: identityError } = await supabase.from('user_identities').upsert(
      {
        user_id,
        provider,
        provider_uid,
        email: normalizedEmail,
        phone,
      },
      { onConflict: 'provider,provider_uid' }
    );

    if (identityError) {
      console.error('Error upserting user_identities:', identityError);
      throw identityError;
    }

    // Step 3: Record device
    const { data: existingDevice } = await supabase
      .from('devices')
      .select('device_id')
      .eq('fingerprint', fingerprint)
      .eq('user_id', user_id)
      .maybeSingle();

    if (existingDevice) {
      // Update last_seen
      await supabase
        .from('devices')
        .update({ last_seen: new Date().toISOString(), ua: userAgent, ip_inet: ip })
        .eq('device_id', existingDevice.device_id);
    } else {
      // Insert new device
      await supabase.from('devices').insert({
        user_id,
        fingerprint,
        ua: userAgent,
        ip_inet: ip,
      });
    }

    // Step 4: Check for potential duplicate accounts
    const { data: duplicateEmails } = await supabase
      .from('app_users')
      .select('user_id')
      .eq('email', normalizedEmail)
      .neq('user_id', user_id);

    const { data: duplicatePhones } = phone
      ? await supabase.from('app_users').select('user_id').eq('phone', phone).neq('user_id', user_id)
      : { data: [] };

    const duplicateUserIds = [
      ...(duplicateEmails || []).map((u) => u.user_id),
      ...(duplicatePhones || []).map((u) => u.user_id),
    ];

    const uniqueDuplicates = [...new Set(duplicateUserIds)];

    // Create pending account_links for each duplicate
    for (const duplicateUserId of uniqueDuplicates) {
      const { error: linkError } = await supabase
        .from('account_links')
        .insert({
          primary_user_id: user_id,
          secondary_user_id: duplicateUserId,
          status: 'pending',
          requested_by: user_id,
        })
        .select()
        .maybeSingle();

      if (linkError && !linkError.message.includes('duplicate key')) {
        console.error('Error creating account link:', linkError);
      }
    }

    // Log successful linkage
    await supabase.from('risk_events').insert({
      user_id,
      event_type: 'identity_linked',
      risk_score: 0,
      reason: 'Identity successfully linked',
      meta: {
        provider,
        email: normalizedEmail,
        duplicates_found: uniqueDuplicates.length,
      },
    });

    console.log('Identity linked:', {
      user_id,
      provider,
      email: normalizedEmail,
      duplicates_found: uniqueDuplicates.length,
    });

    return new Response(
      JSON.stringify({
        success: true,
        duplicates_found: uniqueDuplicates.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in link-user-identity:', error);
    return new Response(
      JSON.stringify({ error: 'Unable to complete user registration' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});