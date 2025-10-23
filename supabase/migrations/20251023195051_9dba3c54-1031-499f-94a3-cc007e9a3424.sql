-- Add provenance and reconciliation columns to player_stats
ALTER TABLE player_stats
ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'actual' CHECK (source_type IN ('actual', 'projection', 'derived')),
ADD COLUMN IF NOT EXISTS freshness_ts timestamptz DEFAULT now(),
ADD COLUMN IF NOT EXISTS confidence numeric DEFAULT 0.95 CHECK (confidence >= 0 AND confidence <= 1),
ADD COLUMN IF NOT EXISTS reconciled_version integer DEFAULT 1,
ADD COLUMN IF NOT EXISTS conflict_flags jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS finalized boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS provider_ids jsonb DEFAULT '{}'::jsonb;

-- Add index for quick lookups by week/season/finalized status
CREATE INDEX IF NOT EXISTS idx_player_stats_week_season_finalized 
ON player_stats(week, season, finalized);

-- Add index for freshness queries
CREATE INDEX IF NOT EXISTS idx_player_stats_freshness 
ON player_stats(freshness_ts DESC) WHERE finalized = false;

COMMENT ON COLUMN player_stats.source_type IS 'Type of data source: actual (boxscore), projection (forecast), or derived (calculated)';
COMMENT ON COLUMN player_stats.freshness_ts IS 'Timestamp when this stat was last updated from source';
COMMENT ON COLUMN player_stats.confidence IS 'Confidence score 0-1 indicating reliability of the data';
COMMENT ON COLUMN player_stats.reconciled_version IS 'Version number incremented each time stats are reconciled';
COMMENT ON COLUMN player_stats.conflict_flags IS 'Array of conflict warnings when multiple sources disagree';
COMMENT ON COLUMN player_stats.finalized IS 'True when all games for this week are complete and stats are final';
COMMENT ON COLUMN player_stats.provider_ids IS 'Map of provider-specific IDs for cross-reference';