-- Deduplicate user_teams by (league_id, team_id) keeping the most recent row
WITH keepers AS (
  SELECT DISTINCT ON (league_id, team_id) id
  FROM public.user_teams
  ORDER BY league_id, team_id, created_at DESC
)
DELETE FROM public.user_teams ut
WHERE ut.id NOT IN (SELECT id FROM keepers);

-- Enforce uniqueness to prevent future duplicates
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'public' AND indexname = 'user_teams_unique_league_team'
  ) THEN
    CREATE UNIQUE INDEX user_teams_unique_league_team ON public.user_teams(league_id, team_id);
  END IF;
END $$;