-- Create trade_value_weekly table
CREATE TABLE IF NOT EXISTS public.trade_value_weekly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  position TEXT NOT NULL,
  team TEXT,
  trade_value NUMERIC NOT NULL DEFAULT 0,
  raw_value NUMERIC NOT NULL DEFAULT 0,
  meta_proj_ros_ppg NUMERIC,
  meta_recent_ppg NUMERIC,
  meta_season_ppg NUMERIC,
  meta_sos_reg_rank NUMERIC,
  meta_sos_po_rank NUMERIC,
  meta_bye_adj NUMERIC,
  current_week INTEGER NOT NULL,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(player_id, snapshot_date)
);

-- Enable RLS
ALTER TABLE public.trade_value_weekly ENABLE ROW LEVEL SECURITY;

-- Anyone can view trade values
CREATE POLICY "Anyone can view trade values"
  ON public.trade_value_weekly
  FOR SELECT
  USING (true);

-- Service can manage trade values
CREATE POLICY "Service can manage trade values"
  ON public.trade_value_weekly
  FOR ALL
  USING (true);

-- Create index for faster lookups
CREATE INDEX idx_trade_value_weekly_player ON public.trade_value_weekly(player_id);
CREATE INDEX idx_trade_value_weekly_position ON public.trade_value_weekly(position);
CREATE INDEX idx_trade_value_weekly_snapshot ON public.trade_value_weekly(snapshot_date);