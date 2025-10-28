-- Create player_pool table to merge rostered and waiver players
CREATE TABLE public.player_pool (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  league_id UUID NOT NULL,
  espn_league_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  position TEXT NOT NULL,
  team TEXT,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  is_owned BOOLEAN NOT NULL DEFAULT false,
  waiver_status TEXT DEFAULT 'ROSTERED',
  percent_owned NUMERIC DEFAULT 0,
  percent_started NUMERIC DEFAULT 0,
  provider_ids JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(league_id, player_id, season, week)
);

-- Enable RLS
ALTER TABLE public.player_pool ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their league player pools" 
ON public.player_pool 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM connected_leagues 
  WHERE connected_leagues.id = player_pool.league_id 
  AND connected_leagues.user_id = auth.uid()
));

CREATE POLICY "Service can manage player pools" 
ON public.player_pool 
FOR ALL 
USING (true);