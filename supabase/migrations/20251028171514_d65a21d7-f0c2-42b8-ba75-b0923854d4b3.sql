-- Add projected stats fields to player_pool table
ALTER TABLE public.player_pool
ADD COLUMN IF NOT EXISTS projected_fp numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS stats jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS applied_breakdown jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS confidence numeric DEFAULT 0.8,
ADD COLUMN IF NOT EXISTS source text DEFAULT 'espn_projection';

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_player_pool_league_week ON public.player_pool(league_id, season, week);
CREATE INDEX IF NOT EXISTS idx_player_pool_projected_fp ON public.player_pool(projected_fp DESC);