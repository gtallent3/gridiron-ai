-- Create table for NFL fantasy points (weekly actual stats)
CREATE TABLE IF NOT EXISTS public.nfl_fantasy_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  position TEXT,
  team TEXT,
  week INTEGER NOT NULL,
  season INTEGER NOT NULL DEFAULT 2025,
  
  -- Raw stats
  passing_yards NUMERIC DEFAULT 0,
  passing_tds INTEGER DEFAULT 0,
  passing_ints INTEGER DEFAULT 0,
  rushing_yards NUMERIC DEFAULT 0,
  rushing_tds INTEGER DEFAULT 0,
  receiving_yards NUMERIC DEFAULT 0,
  receiving_tds INTEGER DEFAULT 0,
  receptions INTEGER DEFAULT 0,
  
  -- Calculated fantasy points
  fantasy_points_std NUMERIC,
  fantasy_points_ppr NUMERIC,
  fantasy_points_half_ppr NUMERIC,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(player_id, week, season)
);

-- Enable RLS
ALTER TABLE public.nfl_fantasy_points ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read fantasy points
CREATE POLICY "Anyone can view fantasy points"
  ON public.nfl_fantasy_points
  FOR SELECT
  USING (true);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_nfl_fantasy_points_season_week 
  ON public.nfl_fantasy_points(season, week);

CREATE INDEX IF NOT EXISTS idx_nfl_fantasy_points_player 
  ON public.nfl_fantasy_points(player_id);

-- Trigger for updated_at
CREATE TRIGGER update_nfl_fantasy_points_updated_at
  BEFORE UPDATE ON public.nfl_fantasy_points
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();