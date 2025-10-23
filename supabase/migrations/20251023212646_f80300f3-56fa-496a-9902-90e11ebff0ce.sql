-- Create projected_player_stats table for weekly projections
CREATE TABLE IF NOT EXISTS public.projected_player_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  team TEXT,
  position TEXT NOT NULL,
  provider_ids JSONB DEFAULT '{}'::jsonb,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'espn_projection',
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence NUMERIC DEFAULT 0.8,
  status_flags JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(player_id, season, week, source)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_projected_player_stats_season_week 
  ON public.projected_player_stats(season, week);
CREATE INDEX IF NOT EXISTS idx_projected_player_stats_player_season_week 
  ON public.projected_player_stats(player_id, season, week);

-- Enable RLS
ALTER TABLE public.projected_player_stats ENABLE ROW LEVEL SECURITY;

-- Anyone can view projected stats
CREATE POLICY "Anyone can view projected stats" 
  ON public.projected_player_stats 
  FOR SELECT 
  USING (true);

-- Service can manage projected stats
CREATE POLICY "Service can manage projected stats" 
  ON public.projected_player_stats 
  FOR ALL 
  USING (true);

-- Enable pg_cron and pg_net extensions for scheduling
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;