
-- Drop the deduplication function since we'll use nfl_fantasy_points instead
DROP FUNCTION IF EXISTS get_player_actuals(INTEGER, INTEGER);
