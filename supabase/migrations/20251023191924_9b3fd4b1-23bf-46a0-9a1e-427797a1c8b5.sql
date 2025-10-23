-- Create player_stats table for raw statistics
CREATE TABLE IF NOT EXISTS public.player_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  team TEXT,
  position TEXT NOT NULL,
  week INTEGER NOT NULL,
  season INTEGER NOT NULL,
  
  -- Passing stats
  passing_yards NUMERIC DEFAULT 0,
  passing_tds INTEGER DEFAULT 0,
  passing_attempts INTEGER DEFAULT 0,
  passing_completions INTEGER DEFAULT 0,
  interceptions INTEGER DEFAULT 0,
  passing_2pt_conversions INTEGER DEFAULT 0,
  
  -- Rushing stats
  rushing_yards NUMERIC DEFAULT 0,
  rushing_tds INTEGER DEFAULT 0,
  rushing_attempts INTEGER DEFAULT 0,
  rushing_2pt_conversions INTEGER DEFAULT 0,
  
  -- Receiving stats
  receptions INTEGER DEFAULT 0,
  receiving_yards NUMERIC DEFAULT 0,
  receiving_tds INTEGER DEFAULT 0,
  receiving_targets INTEGER DEFAULT 0,
  receiving_2pt_conversions INTEGER DEFAULT 0,
  
  -- Kicking stats
  fg_made INTEGER DEFAULT 0,
  fg_attempts INTEGER DEFAULT 0,
  fg_made_0_19 INTEGER DEFAULT 0,
  fg_made_20_29 INTEGER DEFAULT 0,
  fg_made_30_39 INTEGER DEFAULT 0,
  fg_made_40_49 INTEGER DEFAULT 0,
  fg_made_50_plus INTEGER DEFAULT 0,
  xp_made INTEGER DEFAULT 0,
  xp_attempts INTEGER DEFAULT 0,
  
  -- Defense/Special Teams stats
  defensive_tds INTEGER DEFAULT 0,
  fumble_recovery_tds INTEGER DEFAULT 0,
  interception_tds INTEGER DEFAULT 0,
  kick_return_tds INTEGER DEFAULT 0,
  punt_return_tds INTEGER DEFAULT 0,
  sacks NUMERIC DEFAULT 0,
  fumbles_recovered INTEGER DEFAULT 0,
  fumbles_forced INTEGER DEFAULT 0,
  safeties INTEGER DEFAULT 0,
  blocked_kicks INTEGER DEFAULT 0,
  points_allowed INTEGER DEFAULT 0,
  yards_allowed INTEGER DEFAULT 0,
  
  -- Misc stats
  fumbles_lost INTEGER DEFAULT 0,
  
  -- Metadata
  source TEXT NOT NULL, -- 'ESPN', 'Sleeper', 'Yahoo'
  raw_data JSONB, -- Store original API response for reference
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT unique_player_week_season UNIQUE (player_id, week, season, source)
);

-- Create indexes for efficient querying
CREATE INDEX idx_player_stats_player_id ON public.player_stats(player_id);
CREATE INDEX idx_player_stats_week_season ON public.player_stats(week, season);
CREATE INDEX idx_player_stats_position ON public.player_stats(position);
CREATE INDEX idx_player_stats_source ON public.player_stats(source);

-- Enable RLS
ALTER TABLE public.player_stats ENABLE ROW LEVEL SECURITY;

-- Anyone can view player stats
CREATE POLICY "Anyone can view player stats"
  ON public.player_stats
  FOR SELECT
  USING (true);

-- Service role can insert/update
CREATE POLICY "Service can manage player stats"
  ON public.player_stats
  FOR ALL
  USING (true);

-- Add trigger for updated_at
CREATE TRIGGER update_player_stats_updated_at
  BEFORE UPDATE ON public.player_stats
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();