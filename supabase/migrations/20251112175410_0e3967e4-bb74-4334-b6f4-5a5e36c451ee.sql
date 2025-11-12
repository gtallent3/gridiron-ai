-- Add bye_week column to player_pool_v2
ALTER TABLE player_pool_v2 
ADD COLUMN IF NOT EXISTS bye_week BOOLEAN NOT NULL DEFAULT false;

-- Add bye_week column to player_rankings (stores the actual bye week number)
ALTER TABLE player_rankings 
ADD COLUMN IF NOT EXISTS bye_week INTEGER;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_player_pool_v2_bye_week ON player_pool_v2(bye_week);
CREATE INDEX IF NOT EXISTS idx_player_rankings_bye_week ON player_rankings(bye_week);

-- Add comments for documentation
COMMENT ON COLUMN player_pool_v2.bye_week IS 'Indicates if this week is a bye week for the player (true when opponent is null)';
COMMENT ON COLUMN player_rankings.bye_week IS 'The week number when this player has their bye week (1-18)';