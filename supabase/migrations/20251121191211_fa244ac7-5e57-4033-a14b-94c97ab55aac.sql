
-- Consolidate Kenneth Walker III and Tyrone Tracy Jr. canonical_players entries

-- 1. Add ESPN IDs to the Sleeper entries (which have projection data)
UPDATE canonical_players
SET espn_id = '4567048', player_name = 'Kenneth Walker III'
WHERE id = 'dba6305e-e06d-411f-8b7f-efeba99a0880';

UPDATE canonical_players
SET espn_id = '4360516', player_name = 'Tyrone Tracy Jr.'
WHERE id = '461de206-0e3d-4a16-9edc-90457cec5139';

-- 2. Update player_pool_v2 to use the unified canonical_player_id (already correct, no changes needed)

-- 3. Update user_teams rosters to use the correct canonical_player_id
UPDATE user_teams
SET roster = (
  SELECT jsonb_agg(
    CASE 
      WHEN elem ->> 'canonical_player_id' = 'd0264324-1ef6-4725-8d7a-382eb05c99fd' 
      THEN jsonb_set(elem, '{canonical_player_id}', '"dba6305e-e06d-411f-8b7f-efeba99a0880"')
      WHEN elem ->> 'canonical_player_id' = 'd0ca28e3-3172-41a2-9eba-3864fd9b2b57'
      THEN jsonb_set(elem, '{canonical_player_id}', '"461de206-0e3d-4a16-9edc-90457cec5139"')
      ELSE elem
    END
  )
  FROM jsonb_array_elements(roster) as elem
)
WHERE league_id = 'ae9d6118-59e1-4732-9366-2c2c647e9433'
  AND roster::text LIKE '%d0264324-1ef6-4725-8d7a-382eb05c99fd%'
   OR roster::text LIKE '%d0ca28e3-3172-41a2-9eba-3864fd9b2b57%';

-- 4. Delete the duplicate ESPN-only entries
DELETE FROM canonical_players WHERE id IN ('d0264324-1ef6-4725-8d7a-382eb05c99fd', 'd0ca28e3-3172-41a2-9eba-3864fd9b2b57');
