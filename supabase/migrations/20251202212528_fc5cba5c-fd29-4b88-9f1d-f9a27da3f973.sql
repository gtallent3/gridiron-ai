-- Add injury status columns to player_pool_v2
ALTER TABLE public.player_pool_v2 
ADD COLUMN IF NOT EXISTS injury_status text,
ADD COLUMN IF NOT EXISTS injury_status_explanation text;