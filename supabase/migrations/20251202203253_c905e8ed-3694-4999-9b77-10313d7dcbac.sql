-- Create player injury status table
CREATE TABLE public.player_injury_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name text NOT NULL,
  team text,
  week integer NOT NULL,
  season integer NOT NULL DEFAULT 2025,
  status text,
  status_description text DEFAULT '',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE (player_name, team, week, season)
);

-- Enable RLS
ALTER TABLE public.player_injury_status ENABLE ROW LEVEL SECURITY;

-- Allow anyone to view injury status
CREATE POLICY "Anyone can view injury status"
ON public.player_injury_status
FOR SELECT
USING (true);

-- Service can manage injury status
CREATE POLICY "Service can manage injury status"
ON public.player_injury_status
FOR ALL
USING (true);

-- Create index for faster lookups
CREATE INDEX idx_injury_status_player ON public.player_injury_status(player_name, season);
CREATE INDEX idx_injury_status_week ON public.player_injury_status(week, season);