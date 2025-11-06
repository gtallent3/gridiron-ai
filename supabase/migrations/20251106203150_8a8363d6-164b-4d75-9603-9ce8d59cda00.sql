-- Change TD and INT columns to numeric to handle decimal projections
ALTER TABLE public.player_pool 
  ALTER COLUMN passing_tds TYPE numeric,
  ALTER COLUMN passing_ints TYPE numeric,
  ALTER COLUMN rushing_tds TYPE numeric,
  ALTER COLUMN receiving_tds TYPE numeric;