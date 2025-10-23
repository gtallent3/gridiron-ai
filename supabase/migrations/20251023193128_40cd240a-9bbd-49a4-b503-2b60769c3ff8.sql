-- Add unique constraint to player_stats for upserts
ALTER TABLE player_stats
ADD CONSTRAINT player_stats_unique_stat UNIQUE (player_id, week, season, source);