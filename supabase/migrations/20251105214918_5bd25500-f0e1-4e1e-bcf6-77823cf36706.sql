-- Add opponent column to sleeper_projections
ALTER TABLE public.sleeper_projections 
ADD COLUMN opponent text;

-- Add opponent column to nfl_fantasy_points
ALTER TABLE public.nfl_fantasy_points 
ADD COLUMN opponent text;

-- Create index for better join performance
CREATE INDEX idx_sleeper_projections_team_week_season ON public.sleeper_projections(team, week, season);
CREATE INDEX idx_nfl_fantasy_points_team_week_season ON public.nfl_fantasy_points(team, week, season);

-- Populate opponent data from team_schedules for sleeper_projections
UPDATE public.sleeper_projections sp
SET opponent = ts.opponent
FROM public.team_schedules ts
WHERE sp.team = ts.team 
  AND sp.week = ts.week 
  AND sp.season = ts.season;

-- Populate opponent data from team_schedules for nfl_fantasy_points
UPDATE public.nfl_fantasy_points nfp
SET opponent = ts.opponent
FROM public.team_schedules ts
WHERE nfp.team = ts.team 
  AND nfp.week = ts.week 
  AND nfp.season = ts.season;