-- Add new columns to player_rankings for weighted actual PPG calculation
ALTER TABLE public.player_rankings 
ADD COLUMN IF NOT EXISTS actual_last3_ppg numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS actual_season_ppg numeric DEFAULT 0;

-- Add comment explaining the columns
COMMENT ON COLUMN public.player_rankings.actual_last3_ppg IS 'Average actual PPG from the last 3 weeks (before current week)';
COMMENT ON COLUMN public.player_rankings.actual_season_ppg IS 'Average actual PPG from all weeks except the last 3';