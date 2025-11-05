-- Drop the old unique constraint that only allows one row per team per season
ALTER TABLE strength_of_schedule DROP CONSTRAINT IF EXISTS strength_of_schedule_team_season_key;

-- Add new unique constraint to allow per-week rows (team, week, season, opponent)
ALTER TABLE strength_of_schedule ADD CONSTRAINT strength_of_schedule_team_week_season_key 
  UNIQUE (team, week, season, opponent);