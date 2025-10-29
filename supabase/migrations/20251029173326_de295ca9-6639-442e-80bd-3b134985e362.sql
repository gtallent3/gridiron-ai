-- Create table to store encrypted ESPN credentials
CREATE TABLE IF NOT EXISTS public.espn_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  league_id TEXT NOT NULL,
  swid_encrypted TEXT NOT NULL,
  espn_s2_encrypted TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, league_id)
);

-- Enable RLS
ALTER TABLE public.espn_credentials ENABLE ROW LEVEL SECURITY;

-- Users can only access their own credentials
CREATE POLICY "Users can view their own ESPN credentials"
  ON public.espn_credentials
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own ESPN credentials"
  ON public.espn_credentials
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own ESPN credentials"
  ON public.espn_credentials
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own ESPN credentials"
  ON public.espn_credentials
  FOR DELETE
  USING (auth.uid() = user_id);

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION public.update_espn_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_espn_credentials_updated_at
  BEFORE UPDATE ON public.espn_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.update_espn_credentials_updated_at();