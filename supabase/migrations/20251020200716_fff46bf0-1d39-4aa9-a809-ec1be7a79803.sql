-- Add new columns to player_valuations for enhanced ROS tracking
ALTER TABLE player_valuations
ADD COLUMN IF NOT EXISTS remaining_schedule jsonb,
ADD COLUMN IF NOT EXISTS championship_weeks_projection numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS remaining_bye_weeks integer DEFAULT 0;

COMMENT ON COLUMN player_valuations.remaining_schedule IS 'Week-by-week projections with opponent matchups';
COMMENT ON COLUMN player_valuations.championship_weeks_projection IS 'Sum of projected points for weeks 15-17';
COMMENT ON COLUMN player_valuations.remaining_bye_weeks IS 'Number of remaining bye weeks for the player';