-- Add missing UPDATE and DELETE policies for user_teams table
-- Users should be able to update and delete teams in leagues they own

CREATE POLICY "Users can update their own teams"
  ON public.user_teams FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.connected_leagues
      WHERE connected_leagues.id = user_teams.league_id
      AND connected_leagues.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own teams"
  ON public.user_teams FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.connected_leagues
      WHERE connected_leagues.id = user_teams.league_id
      AND connected_leagues.user_id = auth.uid()
    )
  );