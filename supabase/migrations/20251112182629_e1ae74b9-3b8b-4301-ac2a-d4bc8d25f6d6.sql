-- Create team bye weeks table
CREATE TABLE IF NOT EXISTS public.team_bye_weeks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team TEXT NOT NULL UNIQUE,
  bye_week INTEGER NOT NULL,
  season INTEGER NOT NULL DEFAULT 2025,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.team_bye_weeks ENABLE ROW LEVEL SECURITY;

-- Allow anyone to view bye weeks
CREATE POLICY "Anyone can view team bye weeks"
  ON public.team_bye_weeks
  FOR SELECT
  USING (true);

-- Service can manage bye weeks
CREATE POLICY "Service can manage team bye weeks"
  ON public.team_bye_weeks
  FOR ALL
  USING (true);

-- Insert bye week data with correct abbreviations
INSERT INTO public.team_bye_weeks (team, bye_week, season) VALUES
  ('ATL', 5, 2025),
  ('CHI', 5, 2025),
  ('GB', 5, 2025),
  ('PIT', 5, 2025),
  ('HOU', 6, 2025),
  ('MIN', 6, 2025),
  ('BAL', 7, 2025),
  ('BUF', 7, 2025),
  ('ARI', 8, 2025),
  ('DET', 8, 2025),
  ('JAX', 8, 2025),
  ('LV', 8, 2025),
  ('LAR', 8, 2025),
  ('SEA', 8, 2025),
  ('CLE', 9, 2025),
  ('NYJ', 9, 2025),
  ('PHI', 9, 2025),
  ('TB', 9, 2025),
  ('CIN', 10, 2025),
  ('DAL', 10, 2025),
  ('KC', 10, 2025),
  ('TEN', 10, 2025),
  ('IND', 11, 2025),
  ('NO', 11, 2025),
  ('DEN', 12, 2025),
  ('LAC', 12, 2025),
  ('MIA', 12, 2025),
  ('WAS', 12, 2025),
  ('CAR', 14, 2025),
  ('NE', 14, 2025),
  ('NYG', 14, 2025),
  ('SF', 14, 2025)
ON CONFLICT (team) DO UPDATE SET
  bye_week = EXCLUDED.bye_week,
  season = EXCLUDED.season,
  updated_at = now();

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_team_bye_weeks_team_season ON public.team_bye_weeks(team, season);