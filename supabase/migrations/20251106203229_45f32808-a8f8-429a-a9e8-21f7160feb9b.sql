-- Change receptions column to numeric to handle decimal projections
ALTER TABLE public.player_pool 
  ALTER COLUMN receptions TYPE numeric;