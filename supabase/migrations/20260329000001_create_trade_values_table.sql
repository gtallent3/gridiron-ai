-- Recreate trade_values table if it doesn't exist (original migration may have failed)
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

CREATE INDEX IF NOT EXISTS trade_values_snapshot_idx ON public.trade_values(snapshot_date, source);
CREATE INDEX IF NOT EXISTS trade_values_position_idx ON public.trade_values(position);
CREATE INDEX IF NOT EXISTS trade_values_player_idx ON public.trade_values(player_name);

CREATE TABLE IF NOT EXISTS public.trade_values_dlq (
  id BIGSERIAL PRIMARY KEY,
  raw_text TEXT NOT NULL,
  error_message TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.trade_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_values_dlq ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'trade_values' AND policyname = 'Anyone can view trade values'
  ) THEN
    CREATE POLICY "Anyone can view trade values" ON public.trade_values FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'trade_values' AND policyname = 'Service can manage trade values'
  ) THEN
    CREATE POLICY "Service can manage trade values" ON public.trade_values FOR ALL USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'trade_values_dlq' AND policyname = 'Service can manage DLQ'
  ) THEN
    CREATE POLICY "Service can manage DLQ" ON public.trade_values_dlq FOR ALL USING (true);
  END IF;
END $$;
