-- Add status_explanation column to player_injury_status
ALTER TABLE public.player_injury_status 
ADD COLUMN IF NOT EXISTS status_explanation text DEFAULT '';