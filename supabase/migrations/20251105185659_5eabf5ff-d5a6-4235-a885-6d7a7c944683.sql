-- Add player_name column to sleeper_projections
ALTER TABLE public.sleeper_projections 
ADD COLUMN IF NOT EXISTS player_name TEXT;

-- Create index on player_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_sleeper_projections_player_id 
ON public.sleeper_projections(player_id);

-- Create index on normalized_players.sleeper_id for joins
CREATE INDEX IF NOT EXISTS idx_normalized_players_sleeper_id 
ON public.normalized_players(sleeper_id);