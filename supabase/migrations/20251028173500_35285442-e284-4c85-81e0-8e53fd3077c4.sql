-- Add projected stats fields to waiver_wire_players table to match projected_player_stats
ALTER TABLE public.waiver_wire_players
ADD COLUMN IF NOT EXISTS projected_fp numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS stats jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS applied_breakdown jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS confidence numeric DEFAULT 0.8,
ADD COLUMN IF NOT EXISTS source text DEFAULT 'espn_projection',
ADD COLUMN IF NOT EXISTS status_flags jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS last_updated timestamp with time zone DEFAULT now();

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_waiver_wire_projected_fp ON public.waiver_wire_players(league_id, projected_fp DESC);
CREATE INDEX IF NOT EXISTS idx_waiver_wire_week_season ON public.waiver_wire_players(league_id, season, week);