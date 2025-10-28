-- Add marketplace and ownership columns to player_stats
ALTER TABLE public.player_stats
ADD COLUMN IF NOT EXISTS waiver_status text DEFAULT 'ROSTERED',
ADD COLUMN IF NOT EXISTS percent_owned numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS percent_started numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS market_rank integer;

-- Add marketplace and ownership columns to projected_player_stats
ALTER TABLE public.projected_player_stats
ADD COLUMN IF NOT EXISTS waiver_status text DEFAULT 'ROSTERED',
ADD COLUMN IF NOT EXISTS percent_owned numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS percent_started numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS market_rank integer,
ADD COLUMN IF NOT EXISTS projected_fp numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS applied_breakdown jsonb DEFAULT '{}'::jsonb;

-- Create indexes for market filters
CREATE INDEX IF NOT EXISTS idx_market_filters_proj
  ON public.projected_player_stats (season, week, waiver_status);

CREATE INDEX IF NOT EXISTS idx_market_filters_actual
  ON public.player_stats (season, week, waiver_status);

-- Create index for ownership sorting
CREATE INDEX IF NOT EXISTS idx_proj_ownership
  ON public.projected_player_stats (season, week, percent_owned DESC);

CREATE INDEX IF NOT EXISTS idx_actual_ownership
  ON public.player_stats (season, week, percent_owned DESC);