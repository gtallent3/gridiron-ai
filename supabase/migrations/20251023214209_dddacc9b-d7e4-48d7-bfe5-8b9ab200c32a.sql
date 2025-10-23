-- Ensure upserts to user_teams work: add unique index used by onConflict
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_teams_league_team
ON public.user_teams(league_id, team_id);