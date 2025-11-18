import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const requestSchema = z.object({
  feature: z.enum(['ai_assistant', 'start_sit', 'trade_analysis', 'prop_bet']),
  description: z.string().max(500).optional(),
});

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
      return new Response(
        JSON.stringify({ error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    
    // Validate input
    const validationResult = requestSchema.safeParse(body);
    if (!validationResult.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid input', details: validationResult.error.issues }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { feature, description } = validationResult.data;

    // Map feature to transaction type
    const transactionTypeMap: Record<string, string> = {
      'ai_assistant': 'ai_assistant',
      'start_sit': 'start_sit',
      'trade_analysis': 'trade_analysis',
      'prop_bet': 'prop_bet',
    };

    const transactionType = transactionTypeMap[feature];
    if (!transactionType) {
      return new Response(
        JSON.stringify({ error: 'Invalid feature type' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Call deduct_tokens function
    const { data, error } = await supabase.rpc('deduct_tokens', {
      p_user_id: user.id,
      p_amount: 1,
      p_transaction_type: transactionType,
      p_description: description || `Used ${feature.replace('_', ' ')}`
    });

    if (error) {
      console.error('Error deducting tokens:', error);
      return new Response(
        JSON.stringify({ error: 'Unable to process token transaction' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!data.success) {
      return new Response(
        JSON.stringify({ 
          error: data.error,
          insufficient: data.error === 'Insufficient tokens'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        balance: data.balance,
        unlimited: data.unlimited
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in deduct-token function:', error);
    return new Response(
      JSON.stringify({ error: 'Service temporarily unavailable' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
