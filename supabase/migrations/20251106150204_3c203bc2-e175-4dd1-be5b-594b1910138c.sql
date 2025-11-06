-- Add opponent defensive rank column to sleeper_projections
ALTER TABLE sleeper_projections 
ADD COLUMN opponent_def_rank integer;

COMMENT ON COLUMN sleeper_projections.opponent_def_rank IS 'Defensive rank of opponent vs this position (1 = toughest defense, higher = easier matchup)';
