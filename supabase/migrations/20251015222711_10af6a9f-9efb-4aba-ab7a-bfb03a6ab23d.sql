-- Correct store_league_credentials to use proper Vault API argument order and avoid renaming on update
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
  v_secret_id uuid;
BEGIN
  -- Only allow users to store their own credentials
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: Cannot store credentials for other users';
  END IF;

  -- Deterministic secret name per user/platform/league
  v_secret_name := format('league_creds_%s_%s_%s', p_user_id, p_platform, p_league_id);

  -- Try to find existing secret by name
  SELECT id INTO v_secret_id
  FROM vault.secrets
  WHERE name = v_secret_name;

  IF v_secret_id IS NOT NULL THEN
    -- Update only the secret value; keep the existing name to avoid name conflicts
    PERFORM vault.update_secret(v_secret_id, p_credentials::text);
  ELSE
    -- Create secret with value first, then name (correct parameter order)
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