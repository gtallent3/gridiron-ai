-- Add player_name column to roster_snapshots table
ALTER TABLE roster_snapshots 
ADD COLUMN player_name TEXT;