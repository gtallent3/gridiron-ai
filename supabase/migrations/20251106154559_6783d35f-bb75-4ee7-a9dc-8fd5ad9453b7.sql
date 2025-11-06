-- Create team strength of schedule table
CREATE TABLE IF NOT EXISTS public.team_sos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team text NOT NULL,
  season integer NOT NULL DEFAULT 2025,
  position text NOT NULL,
  ros_avg_def_rank numeric DEFAULT 0,
  ros_sos_rank integer,
  playoff_avg_def_rank numeric DEFAULT 0,
  playoff_sos_rank integer,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(team, season, position)
);

-- Enable RLS
ALTER TABLE public.team_sos ENABLE ROW LEVEL SECURITY;

-- Anyone can view team SOS
CREATE POLICY "Anyone can view team SOS"
  ON public.team_sos
  FOR SELECT
  USING (true);

-- Service can manage team SOS
CREATE POLICY "Service can manage team SOS"
  ON public.team_sos
  FOR ALL
  USING (true);

-- Add columns to sleeper_projections
ALTER TABLE public.sleeper_projections
ADD COLUMN IF NOT EXISTS ros_sos_rank integer,
ADD COLUMN IF NOT EXISTS playoff_sos_rank integer;