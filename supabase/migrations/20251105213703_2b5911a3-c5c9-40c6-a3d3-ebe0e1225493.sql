-- Create team schedules table
CREATE TABLE IF NOT EXISTS public.team_schedules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team TEXT NOT NULL,
  week INTEGER NOT NULL,
  opponent TEXT NOT NULL,
  is_home BOOLEAN NOT NULL DEFAULT true,
  season INTEGER NOT NULL DEFAULT 2025,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(team, week, season)
);

-- Enable RLS
ALTER TABLE public.team_schedules ENABLE ROW LEVEL SECURITY;

-- Anyone can view team schedules
CREATE POLICY "Anyone can view team schedules"
  ON public.team_schedules
  FOR SELECT
  USING (true);

-- Service can manage team schedules
CREATE POLICY "Service can manage team schedules"
  ON public.team_schedules
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create index for faster queries
CREATE INDEX idx_team_schedules_team_week ON public.team_schedules(team, week, season);
CREATE INDEX idx_team_schedules_season_week ON public.team_schedules(season, week);