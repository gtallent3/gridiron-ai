-- Add rankings_unlocked_at timestamp to track when rankings were unlocked
ALTER TABLE public.user_tokens 
ADD COLUMN rankings_unlocked_at TIMESTAMP WITH TIME ZONE;

-- Add comment for clarity
COMMENT ON COLUMN public.user_tokens.rankings_unlocked_at IS 'Timestamp when rankings were last unlocked with a token';