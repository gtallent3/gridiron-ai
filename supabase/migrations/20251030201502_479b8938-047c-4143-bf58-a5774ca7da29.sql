-- Add rankings_expires_at column to store the actual expiry timestamp
ALTER TABLE public.user_tokens
ADD COLUMN IF NOT EXISTS rankings_expires_at TIMESTAMP WITH TIME ZONE;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_user_tokens_rankings_expires_at 
ON public.user_tokens(rankings_expires_at) 
WHERE rankings_expires_at IS NOT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN public.user_tokens.rankings_expires_at IS 'Timestamp when positional rankings access expires for this user';