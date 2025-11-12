-- Add trade_value column to player_rankings
ALTER TABLE public.player_rankings 
ADD COLUMN IF NOT EXISTS trade_value NUMERIC DEFAULT 0;

-- Add index for faster trade value queries
CREATE INDEX IF NOT EXISTS idx_player_rankings_trade_value 
ON public.player_rankings(trade_value DESC);