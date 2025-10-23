-- Drop existing unique constraint if it exists
ALTER TABLE public.projected_player_stats 
  DROP CONSTRAINT IF EXISTS projected_player_stats_player_id_season_week_source_key;

-- Recreate with correct constraint name
ALTER TABLE public.projected_player_stats 
  ADD CONSTRAINT projected_player_stats_player_id_season_week_source_key 
  UNIQUE (player_id, season, week, source);