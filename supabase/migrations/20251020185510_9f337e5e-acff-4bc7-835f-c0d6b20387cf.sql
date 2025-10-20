-- Add ppg_projection column to player_valuations table
ALTER TABLE player_valuations 
ADD COLUMN IF NOT EXISTS ppg_projection numeric NOT NULL DEFAULT 0;