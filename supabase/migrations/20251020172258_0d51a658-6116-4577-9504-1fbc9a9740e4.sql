-- First, delete duplicate player_valuation entries keeping only the one with the most recent last_updated_at
DELETE FROM player_valuations
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY player_name, season, week 
             ORDER BY last_updated_at DESC
           ) as row_num
    FROM player_valuations
  ) t
  WHERE t.row_num > 1
);

-- Add a unique index on player_id, season, and week to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_player_valuations_unique 
ON player_valuations(player_id, season, week);