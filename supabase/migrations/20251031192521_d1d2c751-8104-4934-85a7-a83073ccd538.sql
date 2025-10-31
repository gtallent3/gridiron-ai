-- Create trade_values table for FantasyCalc data
CREATE TABLE IF NOT EXISTS public.trade_values (
  id BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  source TEXT NOT NULL,
  player_name TEXT NOT NULL,
  position TEXT NOT NULL,
  team TEXT,
  rank INTEGER,
  tier INTEGER,
  value_score NUMERIC,
  bye_week INTEGER,
  player_id_hint TEXT,
  raw_hash TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, snapshot_date, player_name, position)
);

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS trade_values_snapshot_idx ON public.trade_values(snapshot_date, source);
CREATE INDEX IF NOT EXISTS trade_values_position_idx ON public.trade_values(position);
CREATE INDEX IF NOT EXISTS trade_values_player_idx ON public.trade_values(player_name);

-- Dead letter queue for parsing failures
CREATE TABLE IF NOT EXISTS public.trade_values_dlq (
  id BIGSERIAL PRIMARY KEY,
  raw_text TEXT NOT NULL,
  error_message TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS policies
ALTER TABLE public.trade_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_values_dlq ENABLE ROW LEVEL SECURITY;

-- Anyone can view trade values (read-only)
CREATE POLICY "Anyone can view trade values"
  ON public.trade_values
  FOR SELECT
  USING (true);

-- Service role can manage trade values
CREATE POLICY "Service can manage trade values"
  ON public.trade_values
  FOR ALL
  USING (true);

-- Admins can view DLQ
CREATE POLICY "Admins can view DLQ"
  ON public.trade_values_dlq
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Service can manage DLQ
CREATE POLICY "Service can manage DLQ"
  ON public.trade_values_dlq
  FOR ALL
  USING (true);