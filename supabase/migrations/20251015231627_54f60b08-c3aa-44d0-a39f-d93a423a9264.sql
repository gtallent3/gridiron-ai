-- Harden SECURITY DEFINER functions with comprehensive validation
-- This addresses security finding: vault_functions_security

-- Drop and recreate store_league_credentials with hardened security
DROP FUNCTION IF EXISTS public.store_league_credentials(uuid, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.store_league_credentials(
  p_user_id uuid,
  p_platform text,
  p_league_id text,
  p_credentials jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_secret_name TEXT;
  v_secret_id uuid;
BEGIN
  -- Explicit NULL checks to prevent auth bypass
  IF p_user_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Invalid authentication state';
  END IF;

  -- Only allow users to store their own credentials
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: Cannot store credentials for other users';
  END IF;

  -- Validate platform input (lowercase alphanumeric and underscores only)
  IF p_platform IS NULL OR p_platform !~ '^[a-z_]+$' OR length(p_platform) > 20 THEN
    RAISE EXCEPTION 'Invalid platform identifier';
  END IF;

  -- Validate league_id input (alphanumeric, hyphens, underscores)
  IF p_league_id IS NULL OR p_league_id !~ '^[a-zA-Z0-9_-]+$' OR length(p_league_id) > 100 THEN
    RAISE EXCEPTION 'Invalid league identifier';
  END IF;

  -- Validate credentials payload is not empty
  IF p_credentials IS NULL OR p_credentials::text = '{}' THEN
    RAISE EXCEPTION 'Invalid credentials payload';
  END IF;

  -- Deterministic secret name per user/platform/league
  v_secret_name := format('league_creds_%s_%s_%s', p_user_id, p_platform, p_league_id);

  -- Try to find existing secret by name
  SELECT id INTO v_secret_id
  FROM vault.secrets
  WHERE name = v_secret_name;

  IF v_secret_id IS NOT NULL THEN
    -- Update only the secret value
    PERFORM vault.update_secret(v_secret_id, p_credentials::text);
  ELSE
    -- Create secret with value first, then name
    PERFORM vault.create_secret(p_credentials::text, v_secret_name);
  END IF;

  -- Track or update the reference row
  INSERT INTO public.league_credentials (user_id, platform, league_id, vault_secret_name)
  VALUES (p_user_id, p_platform, p_league_id, v_secret_name)
  ON CONFLICT (user_id, platform, league_id)
  DO UPDATE SET
    vault_secret_name = EXCLUDED.vault_secret_name,
    updated_at = now();

  RETURN v_secret_name;
END;
$$;

-- Drop and recreate get_league_credentials with hardened security
DROP FUNCTION IF EXISTS public.get_league_credentials(uuid, text, text);

CREATE OR REPLACE FUNCTION public.get_league_credentials(
  p_user_id uuid,
  p_platform text,
  p_league_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_secret_name TEXT;
  v_secret_value TEXT;
BEGIN
  -- Explicit NULL checks to prevent auth bypass
  IF p_user_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Invalid authentication state';
  END IF;

  -- Only allow users to retrieve their own credentials
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: Cannot retrieve credentials for other users';
  END IF;

  -- Validate platform input (lowercase alphanumeric and underscores only)
  IF p_platform IS NULL OR p_platform !~ '^[a-z_]+$' OR length(p_platform) > 20 THEN
    RAISE EXCEPTION 'Invalid platform identifier';
  END IF;

  -- Validate league_id input (alphanumeric, hyphens, underscores)
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