-- Drop existing strength_of_schedule table and recreate with new schema
DROP TABLE IF EXISTS public.strength_of_schedule CASCADE;

CREATE TABLE public.strength_of_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season int NOT NULL,
  team text NOT NULL,
  position text NOT NULL CHECK (position IN ('QB', 'RB', 'WR', 'TE')),
  ros_sos numeric,
  playoff_sos numeric,
  ros_weeks int[],
  playoff_weeks int[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (season, team, position)
);

-- Enable RLS
ALTER TABLE public.strength_of_schedule ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view strength of schedule"
  ON public.strength_of_schedule
  FOR SELECT
  USING (true);

CREATE POLICY "Service can manage strength of schedule"
  ON public.strength_of_schedule
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create index for common queries
CREATE INDEX idx_sos_season_team_position ON public.strength_of_schedule(season, team, position);
CREATE INDEX idx_sos_season ON public.strength_of_schedule(season);