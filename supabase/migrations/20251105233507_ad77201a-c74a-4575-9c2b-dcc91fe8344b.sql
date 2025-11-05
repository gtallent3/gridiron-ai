-- Drop the per-week constraint if it exists
ALTER TABLE strength_of_schedule DROP CONSTRAINT IF EXISTS strength_of_schedule_team_week_season_key;

-- Restore the team-season constraint for season-to-date averages
ALTER TABLE strength_of_schedule ADD CONSTRAINT strength_of_schedule_team_season_key 
  UNIQUE (team, season);