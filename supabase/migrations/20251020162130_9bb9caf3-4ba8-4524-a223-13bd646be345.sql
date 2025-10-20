-- Update get_league_credentials to allow service role access
CREATE OR REPLACE FUNCTION public.get_league_credentials(p_user_id uuid, p_platform text, p_league_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_secret_name TEXT;
  v_secret_value TEXT;
  v_is_service_role BOOLEAN;
BEGIN
  -- Check if this is a service role call (auth.uid() is NULL) or user call
  v_is_service_role := (auth.uid() IS NULL);
  
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
  
  -- For non-service-role calls, verify the user is requesting their own credentials
  IF NOT v_is_service_role THEN
    IF p_user_id != auth.uid() THEN
      RAISE EXCEPTION 'Unauthorized: Cannot retrieve credentials for other users';
    END IF;
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
$function$;