-- Ensure upserts work: add a unique constraint on the conflict target used by ingest-espn-all-players
-- 1) Deduplicate any existing rows on (league_id, season, week, player_id, source)
WITH ranked AS (
  SELECT ctid,
         ROW_NUMBER() OVER (
           PARTITION BY league_id, season, week, player_id, source
           ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
         ) AS rn
  FROM public.player_pool
)
DELETE FROM public.player_pool p
USING ranked r
WHERE p.ctid = r.ctid AND r.rn > 1;

-- 2) Add unique constraint to support ON CONFLICT (league_id, season, week, player_id, source)
ALTER TABLE public.player_pool
ADD CONSTRAINT player_pool_unique_league_season_week_player_source
UNIQUE (league_id, season, week, player_id, source);
