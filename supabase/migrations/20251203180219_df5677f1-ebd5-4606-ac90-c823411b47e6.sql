-- Add new columns to player_stats table
ALTER TABLE public.player_stats
ADD COLUMN IF NOT EXISTS opponent_team text,
ADD COLUMN IF NOT EXISTS completions integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS attempts integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS carries integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS snap_counts integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS snap_pct numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS routes_run integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS passing_air_yards numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS passing_epa numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS rushing_epa numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS receiving_air_yards numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS receiving_epa numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS target_share numeric DEFAULT 0;

-- Remove season_type column if it exists (not in new spec)
ALTER TABLE public.player_stats DROP COLUMN IF EXISTS season_type;