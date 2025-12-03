-- Create player_stats table for nflverse weekly player stats
CREATE TABLE public.player_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  player_display_name TEXT,
  team TEXT,
  position TEXT,
  position_group TEXT,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  season_type TEXT,
  headshot_url TEXT,
  passing_yards NUMERIC DEFAULT 0,
  passing_tds INTEGER DEFAULT 0,
  passing_interceptions INTEGER DEFAULT 0,
  rushing_yards NUMERIC DEFAULT 0,
  rushing_tds INTEGER DEFAULT 0,
  receptions INTEGER DEFAULT 0,
  receiving_yards NUMERIC DEFAULT 0,
  receiving_tds INTEGER DEFAULT 0,
  targets INTEGER DEFAULT 0,
  fantasy_points NUMERIC DEFAULT 0,
  fantasy_points_ppr NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(player_id, season, week)
);

-- Create indexes for common queries
CREATE INDEX idx_player_stats_season_week ON public.player_stats(season, week);
CREATE INDEX idx_player_stats_player_id ON public.player_stats(player_id);
CREATE INDEX idx_player_stats_team ON public.player_stats(team);
CREATE INDEX idx_player_stats_position ON public.player_stats(position);

-- Enable RLS
ALTER TABLE public.player_stats ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read player stats
CREATE POLICY "Anyone can view player stats" 
ON public.player_stats FOR SELECT 
USING (true);

-- Service role can manage player stats
CREATE POLICY "Service can manage player stats" 
ON public.player_stats FOR ALL 
USING (true);