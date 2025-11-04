-- Create normalized transactions table for trade history
CREATE TABLE IF NOT EXISTS public.league_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.connected_leagues(id) ON DELETE CASCADE,
  transaction_date TIMESTAMP WITH TIME ZONE NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('trade', 'add', 'drop', 'waiver')),
  teams_involved JSONB NOT NULL DEFAULT '[]'::jsonb,
  players_involved JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_data JSONB,
  external_transaction_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create roster snapshots table for historical tracking
CREATE TABLE IF NOT EXISTS public.roster_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.connected_leagues(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  snapshot_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  position TEXT,
  is_starter BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create fetch tracking table to store last fetch times
CREATE TABLE IF NOT EXISTS public.fetch_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.connected_leagues(id) ON DELETE CASCADE,
  endpoint_type TEXT NOT NULL CHECK (endpoint_type IN ('transactions', 'rosters', 'players', 'projections')),
  last_fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  fetch_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(league_id, endpoint_type)
);

-- Add indices for performance
CREATE INDEX IF NOT EXISTS idx_transactions_league_date ON public.league_transactions(league_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON public.league_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_roster_snapshots_league_team ON public.roster_snapshots(league_id, team_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_roster_snapshots_player ON public.roster_snapshots(player_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_fetch_metadata_league ON public.fetch_metadata(league_id, endpoint_type);

-- Enable RLS
ALTER TABLE public.league_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fetch_metadata ENABLE ROW LEVEL SECURITY;

-- RLS Policies for transactions
CREATE POLICY "Users can view transactions for their leagues"
  ON public.league_transactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.connected_leagues
      WHERE connected_leagues.id = league_transactions.league_id
      AND connected_leagues.user_id = auth.uid()
    )
  );

CREATE POLICY "Service can manage transactions"
  ON public.league_transactions FOR ALL
  USING (true)
  WITH CHECK (true);

-- RLS Policies for roster snapshots
CREATE POLICY "Users can view roster snapshots for their leagues"
  ON public.roster_snapshots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.connected_leagues
      WHERE connected_leagues.id = roster_snapshots.league_id
      AND connected_leagues.user_id = auth.uid()
    )
  );

CREATE POLICY "Service can manage roster snapshots"
  ON public.roster_snapshots FOR ALL
  USING (true)
  WITH CHECK (true);

-- RLS Policies for fetch metadata
CREATE POLICY "Users can view fetch metadata for their leagues"
  ON public.fetch_metadata FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.connected_leagues
      WHERE connected_leagues.id = fetch_metadata.league_id
      AND connected_leagues.user_id = auth.uid()
    )
  );

CREATE POLICY "Service can manage fetch metadata"
  ON public.fetch_metadata FOR ALL
  USING (true)
  WITH CHECK (true);

-- Trigger to update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_league_transactions_updated_at
  BEFORE UPDATE ON public.league_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_fetch_metadata_updated_at
  BEFORE UPDATE ON public.fetch_metadata
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();