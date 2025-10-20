-- Add bye week and injury tracking columns to player_valuations table
ALTER TABLE player_valuations 
ADD COLUMN IF NOT EXISTS is_bye_week boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS injury_status text,
ADD COLUMN IF NOT EXISTS injury_duration_weeks integer DEFAULT 0;

-- Create index for querying by bye week and injury status
CREATE INDEX IF NOT EXISTS idx_player_valuations_bye_injury 
ON player_valuations(season, week, is_bye_week, injury_status);