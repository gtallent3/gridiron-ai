-- Create defensive_rankings table
CREATE TABLE IF NOT EXISTS public.defensive_rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team text NOT NULL,
  week integer NOT NULL,
  season integer NOT NULL DEFAULT 2025,
  position text NOT NULL,
  fantasy_points_allowed numeric DEFAULT 0,
  yards_allowed numeric DEFAULT 0,
  tds_allowed integer DEFAULT 0,
  games_played integer DEFAULT 1,
  avg_points_allowed numeric DEFAULT 0,
  rank integer DEFAULT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(team, week, season, position)
);

-- Create strength_of_schedule table
CREATE TABLE IF NOT EXISTS public.strength_of_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team text NOT NULL,
  week integer NOT NULL,
  season integer NOT NULL DEFAULT 2025,
  opponent text NOT NULL,
  def_rank_qb integer DEFAULT NULL,
  def_rank_rb integer DEFAULT NULL,
  def_rank_wr integer DEFAULT NULL,
  def_rank_te integer DEFAULT NULL,
  avg_points_allowed_qb numeric DEFAULT 0,
  avg_points_allowed_rb numeric DEFAULT 0,
  avg_points_allowed_wr numeric DEFAULT 0,
  avg_points_allowed_te numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(team, week, season)
);

-- Create indexes for better query performance
CREATE INDEX idx_defensive_rankings_team_season ON public.defensive_rankings(team, season);
CREATE INDEX idx_defensive_rankings_position ON public.defensive_rankings(position, season, week);
CREATE INDEX idx_sos_team_season ON public.strength_of_schedule(team, season);
CREATE INDEX idx_sos_week ON public.strength_of_schedule(week, season);

-- Enable RLS
ALTER TABLE public.defensive_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strength_of_schedule ENABLE ROW LEVEL SECURITY;

-- RLS policies (public read access)
CREATE POLICY "Anyone can view defensive rankings"
  ON public.defensive_rankings FOR SELECT
  USING (true);

CREATE POLICY "Service can manage defensive rankings"
  ON public.defensive_rankings FOR ALL
  USING (true);

CREATE POLICY "Anyone can view strength of schedule"
  ON public.strength_of_schedule FOR SELECT
  USING (true);

CREATE POLICY "Service can manage strength of schedule"
  ON public.strength_of_schedule FOR ALL
  USING (true);