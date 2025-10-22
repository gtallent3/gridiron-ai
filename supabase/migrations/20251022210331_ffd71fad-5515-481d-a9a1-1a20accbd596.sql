-- Update deduct_tokens function to only allow unlimited for specific features (not prop bets)
CREATE OR REPLACE FUNCTION public.deduct_tokens(p_user_id uuid, p_amount integer, p_transaction_type token_transaction_type, p_description text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_balance INTEGER;
  v_new_balance INTEGER;
  v_has_unlimited BOOLEAN;
BEGIN
  -- Check if user has unlimited subscription
  SELECT has_unlimited_subscription INTO v_has_unlimited
  FROM public.user_tokens
  WHERE user_id = p_user_id;
  
  -- If unlimited and subscription is active, allow without deducting
  -- BUT NOT for prop bets - subscribers still need tokens for betting
  IF v_has_unlimited 
    AND p_transaction_type != 'prop_bet' 
    AND EXISTS (
      SELECT 1 FROM public.user_tokens
      WHERE user_id = p_user_id
      AND subscription_expires_at > now()
    ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'balance', -1,
      'unlimited', true
    );
  END IF;
  
  -- Get current balance
  SELECT balance INTO v_current_balance
  FROM public.user_tokens
  WHERE user_id = p_user_id;
  
  IF v_current_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User tokens not found');
  END IF;
  
  IF v_current_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient tokens');
  END IF;
  
  -- Deduct tokens
  v_new_balance := v_current_balance - p_amount;
  
  UPDATE public.user_tokens
  SET balance = v_new_balance,
      lifetime_spent = lifetime_spent + p_amount,
      updated_at = now()
  WHERE user_id = p_user_id;
  
  -- Log transaction
  INSERT INTO public.token_transactions (
    user_id,
    transaction_type,
    amount,
    balance_after,
    description
  ) VALUES (
    p_user_id,
    p_transaction_type,
    -p_amount,
    v_new_balance,
    COALESCE(p_description, 'Token spent on ' || p_transaction_type::text)
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'balance', v_new_balance,
    'unlimited', false
  );
END;
$function$;