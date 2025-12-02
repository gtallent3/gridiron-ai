-- Add display_order column for league ordering
ALTER TABLE public.connected_leagues 
ADD COLUMN IF NOT EXISTS display_order integer DEFAULT 0;

-- Set initial display_order based on created_at for existing records
UPDATE public.connected_leagues 
SET display_order = subquery.row_num 
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at ASC) as row_num 
  FROM public.connected_leagues
) AS subquery 
WHERE public.connected_leagues.id = subquery.id;