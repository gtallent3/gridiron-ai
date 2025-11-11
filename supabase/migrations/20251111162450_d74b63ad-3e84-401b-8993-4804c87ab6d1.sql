-- Create canonical_players table (source of truth for all player identities)
CREATE TABLE public.canonical_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name TEXT NOT NULL,
  position TEXT NOT NULL,
  team TEXT,
  sleeper_id TEXT,
  nfl_id TEXT,
  espn_id TEXT,
  yahoo_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sleeper_id),
  UNIQUE(nfl_id)
);

-- Create index for faster lookups
CREATE INDEX idx_canonical_players_name_pos ON public.canonical_players(player_name, position);
CREATE INDEX idx_canonical_players_sleeper ON public.canonical_players(sleeper_id) WHERE sleeper_id IS NOT NULL;
CREATE INDEX idx_canonical_players_nfl ON public.canonical_players(nfl_id) WHERE nfl_id IS NOT NULL;

-- Enable RLS
ALTER TABLE public.canonical_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view canonical players"
  ON public.canonical_players FOR SELECT
  USING (true);

CREATE POLICY "Service can manage canonical players"
  ON public.canonical_players FOR ALL
  USING (true);

-- Create unmatched_players table for manual review
CREATE TABLE public.unmatched_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name TEXT NOT NULL,
  position TEXT NOT NULL,
  team TEXT,
  source TEXT NOT NULL,
  source_player_id TEXT NOT NULL,
  possible_matches JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved BOOLEAN DEFAULT false
);

CREATE INDEX idx_unmatched_players_unresolved ON public.unmatched_players(resolved) WHERE resolved = false;

ALTER TABLE public.unmatched_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service can manage unmatched players"
  ON public.unmatched_players FOR ALL
  USING (true);

CREATE POLICY "Admins can view unmatched players"
  ON public.unmatched_players FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Create player_pool table (unified data source)
CREATE TABLE public.player_pool_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_player_id UUID NOT NULL REFERENCES public.canonical_players(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('sleeper_projection', 'nfl_actual', 'composite')),
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  team TEXT,
  position TEXT NOT NULL,
  projected_fp NUMERIC,
  actual_fp NUMERIC,
  composite_fp NUMERIC,
  passing_yards NUMERIC,
  passing_tds INTEGER,
  passing_ints INTEGER,
  rushing_yards NUMERIC,
  rushing_tds INTEGER,
  receptions NUMERIC,
  receiving_yards NUMERIC,
  receiving_tds INTEGER,
  opponent TEXT,
  opponent_def_rank INTEGER,
  raw_source_ids JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(canonical_player_id, season, week, source)
);

CREATE INDEX idx_player_pool_v2_canonical ON public.player_pool_v2(canonical_player_id);
CREATE INDEX idx_player_pool_v2_season_week ON public.player_pool_v2(season, week);
CREATE INDEX idx_player_pool_v2_source ON public.player_pool_v2(source);

ALTER TABLE public.player_pool_v2 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view player pool v2"
  ON public.player_pool_v2 FOR SELECT
  USING (true);

CREATE POLICY "Service can manage player pool v2"
  ON public.player_pool_v2 FOR ALL
  USING (true);

-- Create player_values_view for trade analyzer
CREATE OR REPLACE VIEW public.player_values_view AS
SELECT 
  cp.id as canonical_player_id,
  cp.player_name,
  cp.position,
  cp.team,
  pp.season,
  pp.week,
  pp.source,
  pp.projected_fp,
  pp.actual_fp,
  pp.composite_fp,
  pp.opponent,
  pp.opponent_def_rank,
  pp.passing_yards,
  pp.passing_tds,
  pp.passing_ints,
  pp.rushing_yards,
  pp.rushing_tds,
  pp.receptions,
  pp.receiving_yards,
  pp.receiving_tds
FROM public.player_pool_v2 pp
JOIN public.canonical_players cp ON pp.canonical_player_id = cp.id;

-- Add trigger for updated_at
CREATE TRIGGER update_canonical_players_updated_at
  BEFORE UPDATE ON public.canonical_players
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_player_pool_v2_updated_at
  BEFORE UPDATE ON public.player_pool_v2
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();