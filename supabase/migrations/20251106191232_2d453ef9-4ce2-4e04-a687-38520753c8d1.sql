-- Create comprehensive player rankings table
CREATE TABLE IF NOT EXISTS public.player_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  position TEXT NOT NULL,
  team TEXT NOT NULL,
  
  -- Stats
  avg_projected_ppg_ros NUMERIC NOT NULL DEFAULT 0,
  avg_actual_ppg NUMERIC NOT NULL DEFAULT 0,
  
  -- Schedule
  bye_week INTEGER,
  ros_sos_rank INTEGER,
  playoff_sos_rank INTEGER,
  
  -- Metadata
  season INTEGER NOT NULL DEFAULT 2025,
  current_week INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Unique constraint per player per season
  UNIQUE(player_id, season)
);

-- Enable RLS
ALTER TABLE public.player_rankings ENABLE ROW LEVEL SECURITY;

-- Anyone can view rankings
CREATE POLICY "Anyone can view player rankings"
  ON public.player_rankings
  FOR SELECT
  USING (true);

-- Service can manage rankings
CREATE POLICY "Service can manage player rankings"
  ON public.player_rankings
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX idx_player_rankings_position ON public.player_rankings(position);
CREATE INDEX idx_player_rankings_team ON public.player_rankings(team);
CREATE INDEX idx_player_rankings_season ON public.player_rankings(season);
CREATE INDEX idx_player_rankings_updated_at ON public.player_rankings(updated_at DESC);