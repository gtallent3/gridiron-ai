-- Clear existing data since we're changing from per-week to per-season structure
DELETE FROM strength_of_schedule;

-- Drop the old unique constraint on team,week,season
ALTER TABLE strength_of_schedule DROP CONSTRAINT IF EXISTS strength_of_schedule_team_week_season_key;

-- Add new unique constraint on team,season
ALTER TABLE strength_of_schedule ADD CONSTRAINT strength_of_schedule_team_season_key UNIQUE (team, season);

-- Make week and opponent nullable
ALTER TABLE strength_of_schedule ALTER COLUMN week DROP NOT NULL;
ALTER TABLE strength_of_schedule ALTER COLUMN opponent DROP NOT NULL;