-- Create table to track which leagues have encrypted credentials in Vault
CREATE TABLE IF NOT EXISTS public.league_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  league_id TEXT NOT NULL,
  vault_secret_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, platform, league_id)
);

-- Enable RLS
ALTER TABLE public.league_credentials ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own credentials
CREATE POLICY "Users can view their own credential references"
ON public.league_credentials FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own credential references"
ON public.league_credentials FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own credential references"
ON public.league_credentials FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own credential references"
ON public.league_credentials FOR DELETE
USING (auth.uid() = user_id);

-- Trigger to update updated_at
CREATE TRIGGER update_league_credentials_updated_at
BEFORE UPDATE ON public.league_credentials
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Security definer function to store credentials in Vault
CREATE OR REPLACE FUNCTION public.store_league_credentials(
  p_user_id UUID,
  p_platform TEXT,
  p_league_id TEXT,
  p_credentials JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret_name TEXT;
BEGIN
  -- Only allow users to store their own credentials
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: Cannot store credentials for other users';
  END IF;
  
  -- Create unique secret name
  v_secret_name := format('league_creds_%s_%s_%s', p_user_id, p_platform, p_league_id);
  
  -- Store in Vault
  PERFORM vault.create_secret(p_credentials::text, v_secret_name);
  
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

-- Security definer function to retrieve credentials from Vault
CREATE OR REPLACE FUNCTION public.get_league_credentials(
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
  v_secret_value TEXT;
BEGIN
  -- Only allow users to retrieve their own credentials
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: Cannot retrieve credentials for other users';
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