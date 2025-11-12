-- Add bye_week column to sleeper_projections
ALTER TABLE sleeper_projections 
ADD COLUMN bye_week BOOLEAN NOT NULL DEFAULT false;

-- Update existing records to mark bye weeks where opponent is null
UPDATE sleeper_projections 
SET bye_week = true 
WHERE opponent IS NULL;

-- Add index for performance on bye_week queries
CREATE INDEX idx_sleeper_projections_bye_week ON sleeper_projections(bye_week);

-- Add comment for documentation
COMMENT ON COLUMN sleeper_projections.bye_week IS 'Indicates if this week is a bye week for the player (true when opponent is null)';