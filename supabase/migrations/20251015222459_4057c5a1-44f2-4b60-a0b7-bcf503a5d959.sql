-- Fix store_league_credentials to update existing credentials instead of failing
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
SET search_path TO 'public'
AS $$
DECLARE
  v_secret_name TEXT;
  v_existing_secret TEXT;
BEGIN
  -- Only allow users to store their own credentials
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: Cannot store credentials for other users';
  END IF;
  
  -- Create unique secret name
  v_secret_name := format('league_creds_%s_%s_%s', p_user_id, p_platform, p_league_id);
  
  -- Check if secret already exists
  SELECT name INTO v_existing_secret
  FROM vault.secrets
  WHERE name = v_secret_name;
  
  -- Update or create the secret
  IF v_existing_secret IS NOT NULL THEN
    -- Update existing secret
    PERFORM vault.update_secret(
      vault.secrets.id,
      v_secret_name,
      p_credentials::text
    )
    FROM vault.secrets
    WHERE name = v_secret_name;
  ELSE
    -- Create new secret
    PERFORM vault.create_secret(p_credentials::text, v_secret_name);
  END IF;
  
  -- Track the secret reference
  INSERT INTO public.league_credentials (user_id, platform, league_id, vault_secret_name)
  VALUES (p_user_id, p_platform, p_league_id, v_secret_name)
  ON CONFLICT (user_id, platform, league_id) 
  DO UPDATE SET 
    vault_secret_name = EXCLUDED.vault_secret_name,
    updated_at = now();
  
  RETURN v_secret_name;
END;
$$;