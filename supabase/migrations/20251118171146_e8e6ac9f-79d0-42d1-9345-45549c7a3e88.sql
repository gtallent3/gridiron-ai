
-- Fix search_path for get_player_actuals function
CREATE OR REPLACE FUNCTION get_player_actuals(p_season INTEGER, p_current_week INTEGER)
RETURNS TABLE (
  canonical_player_id UUID,
  player_name TEXT,
  "position" TEXT,
  team TEXT,
  week INTEGER,
  actual_fp NUMERIC
) 
LANGUAGE plpgsql 
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (pp.canonical_player_id, pp.week)
    pp.canonical_player_id,
    pp.player_name,
    pp."position",
    pp.team,
    pp.week,
    pp.actual_fp
  FROM player_pool_v2 pp
  WHERE pp.season = p_season
    AND pp.actual_fp IS NOT NULL
    AND pp.week <= p_current_week
    AND pp."position" IN ('QB', 'RB', 'WR', 'TE')
    AND pp.team IS NOT NULL
  ORDER BY pp.canonical_player_id, pp.week, pp.actual_fp DESC NULLS LAST;
END;
$$;
