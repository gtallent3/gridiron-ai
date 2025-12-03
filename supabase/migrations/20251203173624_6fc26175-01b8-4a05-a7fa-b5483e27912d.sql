-- Rename nfl_fantasy_points table to actual_weekly_points
ALTER TABLE public.nfl_fantasy_points RENAME TO actual_weekly_points;

-- Rename the index as well
ALTER INDEX IF EXISTS idx_nfl_fantasy_points_team_week_season RENAME TO idx_actual_weekly_points_team_week_season;