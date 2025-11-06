-- Create player_pool table to combine actual and projected data for all 18 weeks
CREATE TABLE IF NOT EXISTS public.player_pool (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id text NOT NULL,
  player_name text NOT NULL,
  position text NOT NULL,
  team text NOT NULL,
  week integer NOT NULL,
  season integer NOT NULL DEFAULT 2025,
  points_ppr numeric NOT NULL DEFAULT 0,
  is_actual boolean NOT NULL DEFAULT false,
  passing_yards numeric DEFAULT 0,
  passing_tds integer DEFAULT 0,
  passing_ints integer DEFAULT 0,
  rushing_yards numeric DEFAULT 0,
  rushing_tds integer DEFAULT 0,
  receptions integer DEFAULT 0,
  receiving_yards numeric DEFAULT 0,
  receiving_tds integer DEFAULT 0,
  opponent text,
  opponent_def_rank integer,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(player_id, week, season)
);

-- Enable RLS
ALTER TABLE public.player_pool ENABLE ROW LEVEL SECURITY;

-- Anyone can view player pool data
CREATE POLICY "Anyone can view player pool"
  ON public.player_pool
  FOR SELECT
  USING (true);

-- Service can manage player pool
CREATE POLICY "Service can manage player pool"
  ON public.player_pool
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create index for common queries
CREATE INDEX IF NOT EXISTS idx_player_pool_player_season ON public.player_pool(player_id, season);
CREATE INDEX IF NOT EXISTS idx_player_pool_week_season ON public.player_pool(week, season);
CREATE INDEX IF NOT EXISTS idx_player_pool_position ON public.player_pool(position);