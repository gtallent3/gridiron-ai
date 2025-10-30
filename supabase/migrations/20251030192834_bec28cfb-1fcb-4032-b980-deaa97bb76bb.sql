-- Add rankings_unlocked_week field to user_tokens table
ALTER TABLE public.user_tokens 
ADD COLUMN rankings_unlocked_week INTEGER;

-- Add comment for clarity
COMMENT ON COLUMN public.user_tokens.rankings_unlocked_week IS 'Week number when rankings were last unlocked via token';
