-- Add matchup and team record columns to connected_leagues table
ALTER TABLE connected_leagues 
ADD COLUMN IF NOT EXISTS current_week INTEGER,
ADD COLUMN IF NOT EXISTS opponent_team_id TEXT;

-- Add team record and projected points columns to user_teams table
ALTER TABLE user_teams 
ADD COLUMN IF NOT EXISTS wins INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS losses INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS ties INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_projected NUMERIC DEFAULT 0;