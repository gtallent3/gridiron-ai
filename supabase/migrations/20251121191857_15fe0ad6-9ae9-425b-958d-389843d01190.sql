
-- Consolidate players with Jr./Sr./II/III suffix duplicates

-- 1. James Cook / James Cook III
UPDATE canonical_players
SET espn_id = '4379399', player_name = 'James Cook'
WHERE id = 'd78baacf-82c1-4f56-8dcf-623f5e64e4a8';

-- 2. Kyle Pitts / Kyle Pitts Sr. (Note: "Sr." is likely an ESPN data error, Kyle Pitts doesn't have Sr.)
UPDATE canonical_players
SET espn_id = '4360248', player_name = 'Kyle Pitts'
WHERE id = '43e6a6fd-6bae-43ae-89de-45ffa04c7bd5';

-- 3. Brian Thomas / Brian Thomas Jr.
UPDATE canonical_players
SET espn_id = '4432773', player_name = 'Brian Thomas Jr.'
WHERE id = 'b753a590-3118-4e7c-9145-1b248cdead2c';

-- 4. Marvin Harrison / Marvin Harrison Jr.
UPDATE canonical_players
SET espn_id = '4432708', player_name = 'Marvin Harrison Jr.'
WHERE id = '1daeb819-96f3-4a0d-baf9-53e869834e5a';

-- 5. Update user_teams rosters to use correct canonical_player_id
UPDATE user_teams
SET roster = (
  SELECT jsonb_agg(
    CASE 
      -- James Cook III -> James Cook
      WHEN elem ->> 'canonical_player_id' = '7bc0ccdb-946c-4b51-9f92-4274f6b13dc8'
      THEN jsonb_set(elem, '{canonical_player_id}', '"d78baacf-82c1-4f56-8dcf-623f5e64e4a8"')
      -- Kyle Pitts Sr. -> Kyle Pitts
      WHEN elem ->> 'canonical_player_id' = 'fc033a27-b6d5-4055-96f4-88676525ad38'
      THEN jsonb_set(elem, '{canonical_player_id}', '"43e6a6fd-6bae-43ae-89de-45ffa04c7bd5"')
      -- Brian Thomas Jr. -> Brian Thomas
      WHEN elem ->> 'canonical_player_id' = '812b460d-7f32-4af6-864d-dbd7c849d8da'
      THEN jsonb_set(elem, '{canonical_player_id}', '"b753a590-3118-4e7c-9145-1b248cdead2c"')
      -- Marvin Harrison Jr. -> Marvin Harrison
      WHEN elem ->> 'canonical_player_id' = 'd422f0be-8ecf-4be8-8d09-a6d44f9497c7'
      THEN jsonb_set(elem, '{canonical_player_id}', '"1daeb819-96f3-4a0d-baf9-53e869834e5a"')
      ELSE elem
    END
  )
  FROM jsonb_array_elements(roster) as elem
)
WHERE league_id = 'ae9d6118-59e1-4732-9366-2c2c647e9433'
  AND (roster::text LIKE '%7bc0ccdb-946c-4b51-9f92-4274f6b13dc8%'
   OR roster::text LIKE '%fc033a27-b6d5-4055-96f4-88676525ad38%'
   OR roster::text LIKE '%812b460d-7f32-4af6-864d-dbd7c849d8da%'
   OR roster::text LIKE '%d422f0be-8ecf-4be8-8d09-a6d44f9497c7%');

-- 6. Delete duplicate ESPN-only entries
DELETE FROM canonical_players 
WHERE id IN (
  '7bc0ccdb-946c-4b51-9f92-4274f6b13dc8',
  'fc033a27-b6d5-4055-96f4-88676525ad38',
  '812b460d-7f32-4af6-864d-dbd7c849d8da',
  'd422f0be-8ecf-4be8-8d09-a6d44f9497c7'
);
