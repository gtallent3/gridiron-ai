-- Create enum for league platforms
CREATE TYPE public.league_platform AS ENUM ('espn', 'yahoo', 'sleeper');

-- Create enum for scoring types
CREATE TYPE public.scoring_type AS ENUM ('standard', 'ppr', 'half_ppr', 'custom');

-- Create connected_leagues table
CREATE TABLE public.connected_leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform league_platform NOT NULL,
  league_id TEXT NOT NULL,
  league_name TEXT NOT NULL,
  scoring_type scoring_type NOT NULL,
  league_size INTEGER,
  scoring_settings JSONB,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  auto_refresh BOOLEAN DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform, league_id)
);

-- Create user_teams table
CREATE TABLE public.user_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.connected_leagues(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  roster JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(league_id, team_id)
);

-- Create normalized_players table
CREATE TABLE public.normalized_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id TEXT NOT NULL UNIQUE,
  player_name TEXT NOT NULL,
  position TEXT NOT NULL,
  team TEXT,
  espn_id TEXT,
  yahoo_id TEXT,
  sleeper_id TEXT,
  stats JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.connected_leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.normalized_players ENABLE ROW LEVEL SECURITY;

-- RLS Policies for connected_leagues
CREATE POLICY "Users can view their own leagues"
  ON public.connected_leagues FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own leagues"
  ON public.connected_leagues FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own leagues"
  ON public.connected_leagues FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own leagues"
  ON public.connected_leagues FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for user_teams
CREATE POLICY "Users can view their own teams"
  ON public.user_teams FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.connected_leagues
      WHERE connected_leagues.id = user_teams.league_id
      AND connected_leagues.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own teams"
  ON public.user_teams FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.connected_leagues
      WHERE connected_leagues.id = user_teams.league_id
      AND connected_leagues.user_id = auth.uid()
    )
  );

-- RLS Policies for normalized_players (public read)
CREATE POLICY "Anyone can view normalized players"
  ON public.normalized_players FOR SELECT
  USING (true);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers
CREATE TRIGGER update_connected_leagues_updated_at
  BEFORE UPDATE ON public.connected_leagues
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_user_teams_updated_at
  BEFORE UPDATE ON public.user_teams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_normalized_players_updated_at
  BEFORE UPDATE ON public.normalized_players
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();