-- Create leagues table to store fantasy league data
CREATE TABLE IF NOT EXISTS public.leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('yahoo', 'espn', 'sleeper')),
  platform_league_id TEXT NOT NULL,
  name TEXT NOT NULL,
  season INTEGER NOT NULL,
  roster_data JSONB,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, platform, platform_league_id)
);

-- Enable RLS
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;

-- Users can view their own leagues
CREATE POLICY "Users can view their own leagues"
ON public.leagues
FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own leagues
CREATE POLICY "Users can insert their own leagues"
ON public.leagues
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own leagues
CREATE POLICY "Users can update their own leagues"
ON public.leagues
FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own leagues
CREATE POLICY "Users can delete their own leagues"
ON public.leagues
FOR DELETE
USING (auth.uid() = user_id);

-- Add trigger for updated_at
CREATE TRIGGER update_leagues_updated_at
BEFORE UPDATE ON public.leagues
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_leagues_user_platform ON public.leagues(user_id, platform);
CREATE INDEX IF NOT EXISTS idx_leagues_platform_league_id ON public.leagues(platform, platform_league_id);