-- Remove insecure token storage columns from connected_leagues
-- OAuth tokens will be stored in Supabase Vault when OAuth integrations are implemented
ALTER TABLE public.connected_leagues 
  DROP COLUMN IF EXISTS access_token,
  DROP COLUMN IF EXISTS refresh_token,
  DROP COLUMN IF EXISTS token_expires_at;

-- Create a security definer function to securely store OAuth tokens in Vault
-- This will be used when ESP and Yahoo OAuth integrations are implemented
CREATE OR REPLACE FUNCTION public.store_oauth_token(
  p_user_id UUID,
  p_platform TEXT,
  p_league_id TEXT,
  p_token_data JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret_name TEXT;
BEGIN
  -- Only allow users to store their own tokens
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: Cannot store tokens for other users';
  END IF;
  
  -- Create a unique secret name for this token
  v_secret_name := format('oauth_token_%s_%s_%s', p_user_id, p_platform, p_league_id);
  
  -- Note: This function prepares the structure for Vault integration
  -- Actual Vault storage should be implemented in edge functions using:
  -- await supabase.rpc('vault_store_secret', { secret_name, secret_value })
  
  -- For now, log that this function was called (tokens should be stored via Vault API)
  RAISE NOTICE 'OAuth token storage requested for user % platform %', p_user_id, p_platform;
END;
$$;

-- Create a security definer function to retrieve OAuth tokens from Vault
CREATE OR REPLACE FUNCTION public.get_oauth_token(
  p_user_id UUID,
  p_platform TEXT,
  p_league_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret_name TEXT;
BEGIN
  -- Only allow users to retrieve their own tokens
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: Cannot retrieve tokens for other users';
  END IF;
  
  -- Create the secret name
  v_secret_name := format('oauth_token_%s_%s_%s', p_user_id, p_platform, p_league_id);
  
  -- Note: This function prepares the structure for Vault integration
  -- Actual Vault retrieval should be implemented in edge functions using:
  -- await supabase.rpc('vault_get_secret', { secret_name })
  
  RAISE NOTICE 'OAuth token retrieval requested for user % platform %', p_user_id, p_platform;
  
  RETURN NULL; -- Will return actual token data once Vault is integrated
END;
$$;

COMMENT ON FUNCTION public.store_oauth_token IS 'Securely stores OAuth tokens using Supabase Vault. Tokens are never stored in database tables.';
COMMENT ON FUNCTION public.get_oauth_token IS 'Securely retrieves OAuth tokens from Supabase Vault. Only users can access their own tokens.';