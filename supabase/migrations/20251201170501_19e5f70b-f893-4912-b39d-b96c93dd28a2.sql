
-- Fix Security Definer View issue
-- The player_values_view needs to use SECURITY INVOKER instead of SECURITY DEFINER
-- to ensure it enforces RLS policies of the querying user, not the view owner

-- Drop the existing view
DROP VIEW IF EXISTS public.player_values_view;

-- Recreate the view with SECURITY INVOKER
CREATE VIEW public.player_values_view
WITH (security_invoker = true)
AS
SELECT 
  cp.id AS canonical_player_id,
  cp.player_name,
  cp."position",
  cp.team,
  pp.season,
  pp.week,
  pp.source,
  pp.projected_fp,
  pp.actual_fp,
  pp.composite_fp,
  pp.opponent,
  pp.opponent_def_rank,
  pp.passing_yards,
  pp.passing_tds,
  pp.passing_ints,
  pp.rushing_yards,
  pp.rushing_tds,
  pp.receptions,
  pp.receiving_yards,
  pp.receiving_tds
FROM player_pool_v2 pp
JOIN canonical_players cp ON pp.canonical_player_id = cp.id;
