-- Fix RPC function to remove service role bypass
-- This ensures all credential access requires proper user authentication
CREATE OR REPLACE FUNCTION public.get_league_credentials(p_user_id uuid, p_platform text, p_league_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_secret_name TEXT;
  v_secret_value TEXT;
BEGIN
  -- ALWAYS require authenticated user - no service role bypass
  IF auth.uid() IS NULL OR p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: Cannot retrieve credentials for other users';
  END IF;
  
  -- Validate inputs
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid authentication state';
  END IF;

  IF p_platform IS NULL OR p_platform !~ '^[a-z_]+$' OR length(p_platform) > 20 THEN
    RAISE EXCEPTION 'Invalid platform identifier';
  END IF;

  IF p_league_id IS NULL OR p_league_id !~ '^[a-zA-Z0-9_-]+$' OR length(p_league_id) > 100 THEN
    RAISE EXCEPTION 'Invalid league identifier';
  END IF;
  
  -- Get the secret name
  SELECT vault_secret_name INTO v_secret_name
  FROM public.league_credentials
  WHERE user_id = p_user_id 
    AND platform = p_platform 
    AND league_id = p_league_id;
  
  IF v_secret_name IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Retrieve from Vault
  SELECT decrypted_secret INTO v_secret_value
  FROM vault.decrypted_secrets
  WHERE name = v_secret_name;
  
  RETURN v_secret_value::jsonb;
END;
$$;