-- Create enum for risk profiles
CREATE TYPE public.risk_profile AS ENUM ('aggressive', 'balanced', 'conservative');

-- Create enum for player positions
CREATE TYPE public.player_position AS ENUM ('QB', 'RB', 'WR', 'TE', 'K', 'DEF');

-- Table to store weekly player valuations
CREATE TABLE public.player_valuations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  position player_position NOT NULL,
  team TEXT,
  week INTEGER NOT NULL,
  season INTEGER NOT NULL,
  
  -- Core value metrics
  player_value NUMERIC NOT NULL DEFAULT 0, -- Overall ROS value
  ros_projection NUMERIC NOT NULL DEFAULT 0, -- Rest of season projected points
  next_3_weeks_projection NUMERIC NOT NULL DEFAULT 0, -- Short term projection
  
  -- Context factors
  usage_trend NUMERIC DEFAULT 0, -- Recent usage trend (-1 to 1)
  role_stability NUMERIC DEFAULT 1, -- 0 (volatile) to 1 (stable)
  injury_risk NUMERIC DEFAULT 0, -- 0 (healthy) to 1 (high risk)
  schedule_difficulty NUMERIC DEFAULT 0, -- -1 (easy) to 1 (hard)
  playoff_schedule_difficulty NUMERIC DEFAULT 0, -- Weeks 15-17
  sentiment_score NUMERIC DEFAULT 0, -- -1 (bearish) to 1 (bullish)
  
  -- Metadata
  confidence_score INTEGER DEFAULT 70, -- 0-100
  volatility_flag BOOLEAN DEFAULT false,
  last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(player_id, week, season)
);

-- Table for team needs and strategies
CREATE TABLE public.team_strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.connected_leagues(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  
  -- Team context
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  ties INTEGER DEFAULT 0,
  playoff_odds NUMERIC DEFAULT 0.5, -- 0 to 1
  playoff_position INTEGER, -- Current playoff standing
  
  -- Strategy settings
  risk_profile risk_profile DEFAULT 'balanced',
  must_win_mode BOOLEAN DEFAULT false, -- Emphasize next 3 weeks
  
  -- Position needs (0 = weak, 1 = strong)
  qb_strength NUMERIC DEFAULT 0.5,
  rb_strength NUMERIC DEFAULT 0.5,
  wr_strength NUMERIC DEFAULT 0.5,
  te_strength NUMERIC DEFAULT 0.5,
  
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(league_id, team_id)
);

-- Table for trade evaluations history
CREATE TABLE public.trade_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.connected_leagues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Trade details
  my_team_id TEXT NOT NULL,
  their_team_id TEXT NOT NULL,
  my_players JSONB NOT NULL, -- Array of player objects
  their_players JSONB NOT NULL,
  
  -- Evaluation results
  grade TEXT NOT NULL, -- A-F
  verdict TEXT NOT NULL, -- accept, decline, close
  confidence INTEGER NOT NULL, -- 0-100
  
  -- Value deltas
  ros_points_delta NUMERIC NOT NULL,
  next_3_weeks_delta NUMERIC NOT NULL,
  best_player_bonus_applied BOOLEAN DEFAULT false,
  
  -- Explanation
  summary TEXT,
  key_factors JSONB, -- Array of explanation strings
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_player_valuations_player_week ON public.player_valuations(player_id, week, season);
CREATE INDEX idx_player_valuations_position ON public.player_valuations(position);
CREATE INDEX idx_team_strategies_league ON public.team_strategies(league_id);
CREATE INDEX idx_trade_evaluations_user ON public.trade_evaluations(user_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.player_valuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_evaluations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for player_valuations (public read, system write)
CREATE POLICY "Anyone can view player valuations"
  ON public.player_valuations FOR SELECT
  TO authenticated
  USING (true);

-- RLS Policies for team_strategies
CREATE POLICY "Users can view their league team strategies"
  ON public.team_strategies FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.connected_leagues
      WHERE connected_leagues.id = team_strategies.league_id
      AND connected_leagues.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their league team strategies"
  ON public.team_strategies FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.connected_leagues
      WHERE connected_leagues.id = team_strategies.league_id
      AND connected_leagues.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their league team strategies"
  ON public.team_strategies FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.connected_leagues
      WHERE connected_leagues.id = team_strategies.league_id
      AND connected_leagues.user_id = auth.uid()
    )
  );

-- RLS Policies for trade_evaluations
CREATE POLICY "Users can view their own trade evaluations"
  ON public.trade_evaluations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own trade evaluations"
  ON public.trade_evaluations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_player_valuations_updated_at
  BEFORE UPDATE ON public.player_valuations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_team_strategies_updated_at
  BEFORE UPDATE ON public.team_strategies
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();