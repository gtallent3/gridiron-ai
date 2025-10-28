-- Create team_positional_strengths table for caching positional rankings
CREATE TABLE IF NOT EXISTS public.team_positional_strengths (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.connected_leagues(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  position TEXT NOT NULL,
  pss NUMERIC NOT NULL DEFAULT 0, -- Positional Strength Score
  rank INTEGER NOT NULL DEFAULT 0,
  z_score NUMERIC NOT NULL DEFAULT 0,
  delta_vs_median NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(league_id, team_id, position)
);

-- Add index for fast lookups
CREATE INDEX idx_team_positional_strengths_league ON public.team_positional_strengths(league_id);
CREATE INDEX idx_team_positional_strengths_team ON public.team_positional_strengths(league_id, team_id);

-- Enable RLS
ALTER TABLE public.team_positional_strengths ENABLE ROW LEVEL SECURITY;

-- Users can view positional strengths for their leagues
CREATE POLICY "Users can view their league positional strengths"
ON public.team_positional_strengths
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.connected_leagues
    WHERE id = team_positional_strengths.league_id
    AND user_id = auth.uid()
  )
);

-- Service can manage all positional strengths
CREATE POLICY "Service can manage positional strengths"
ON public.team_positional_strengths
FOR ALL
USING (true)
WITH CHECK (true);

-- Create player_value_cache table for storing computed player values
CREATE TABLE IF NOT EXISTS public.player_value_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.connected_leagues(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  position TEXT NOT NULL,
  team TEXT,
  value_score NUMERIC NOT NULL DEFAULT 0,
  projected_fp_ros NUMERIC NOT NULL DEFAULT 0,
  consistency_multiplier NUMERIC NOT NULL DEFAULT 1.0,
  schedule_factor NUMERIC NOT NULL DEFAULT 1.0,
  risk_adjustment NUMERIC NOT NULL DEFAULT 1.0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(league_id, player_id)
);

-- Add indexes
CREATE INDEX idx_player_value_cache_league ON public.player_value_cache(league_id);
CREATE INDEX idx_player_value_cache_player ON public.player_value_cache(league_id, player_id);
CREATE INDEX idx_player_value_cache_value ON public.player_value_cache(league_id, value_score DESC);

-- Enable RLS
ALTER TABLE public.player_value_cache ENABLE ROW LEVEL SECURITY;

-- Users can view value cache for their leagues
CREATE POLICY "Users can view their league value cache"
ON public.player_value_cache
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.connected_leagues
    WHERE id = player_value_cache.league_id
    AND user_id = auth.uid()
  )
);

-- Service can manage all value cache
CREATE POLICY "Service can manage value cache"
ON public.player_value_cache
FOR ALL
USING (true)
WITH CHECK (true);