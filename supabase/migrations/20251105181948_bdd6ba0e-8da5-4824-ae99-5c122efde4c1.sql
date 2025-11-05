-- Create table for Sleeper NFL projections
CREATE TABLE IF NOT EXISTS public.sleeper_projections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id text NOT NULL,
  week integer NOT NULL,
  season integer NOT NULL,
  team text,
  position text,
  pts_std numeric DEFAULT 0,
  pts_ppr numeric DEFAULT 0,
  pts_half_ppr numeric DEFAULT 0,
  pass_yd numeric DEFAULT 0,
  pass_td integer DEFAULT 0,
  pass_int integer DEFAULT 0,
  rush_yd numeric DEFAULT 0,
  rush_td integer DEFAULT 0,
  rec numeric DEFAULT 0,
  rec_yd numeric DEFAULT 0,
  rec_td integer DEFAULT 0,
  raw_stats jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(player_id, week, season)
);

-- Enable RLS
ALTER TABLE public.sleeper_projections ENABLE ROW LEVEL SECURITY;

-- Allow admins to manage projections
CREATE POLICY "Admins can manage projections"
ON public.sleeper_projections
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Allow service role to manage projections
CREATE POLICY "Service can manage projections"
ON public.sleeper_projections
FOR ALL
USING (true);

-- Allow anyone to view projections
CREATE POLICY "Anyone can view projections"
ON public.sleeper_projections
FOR SELECT
TO authenticated
USING (true);

-- Create index for faster queries
CREATE INDEX idx_sleeper_projections_week_season ON public.sleeper_projections(week, season);
CREATE INDEX idx_sleeper_projections_player ON public.sleeper_projections(player_id);

-- Add trigger for updated_at
CREATE TRIGGER update_sleeper_projections_updated_at
  BEFORE UPDATE ON public.sleeper_projections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();