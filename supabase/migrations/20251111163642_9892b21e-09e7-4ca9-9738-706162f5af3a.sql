-- Add player_name column to player_pool_v2
ALTER TABLE player_pool_v2 
ADD COLUMN player_name TEXT;

-- Populate existing records with player names from canonical_players
UPDATE player_pool_v2 pp
SET player_name = cp.player_name
FROM canonical_players cp
WHERE pp.canonical_player_id = cp.id;