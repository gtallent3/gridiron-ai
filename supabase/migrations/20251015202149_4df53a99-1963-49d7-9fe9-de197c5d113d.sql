-- Add user_team_id to connected_leagues to track which team belongs to the authenticated user
ALTER TABLE connected_leagues ADD COLUMN user_team_id TEXT;