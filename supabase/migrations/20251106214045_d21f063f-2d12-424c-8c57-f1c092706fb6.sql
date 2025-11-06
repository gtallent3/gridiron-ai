-- Add did_not_play flag to player_pool to track injury/DNP weeks
ALTER TABLE player_pool 
ADD COLUMN did_not_play boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN player_pool.did_not_play IS 'True when projection data was used to fill a missing past week (injury/DNP)';