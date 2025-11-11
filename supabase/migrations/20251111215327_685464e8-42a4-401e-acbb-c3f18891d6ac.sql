-- Normalize LA Rams team abbreviation from LAR to LA in sleeper_projections
UPDATE sleeper_projections
SET team = 'LA'
WHERE team = 'LAR';

-- Also normalize opponent column
UPDATE sleeper_projections
SET opponent = 'LA'
WHERE opponent = 'LAR';