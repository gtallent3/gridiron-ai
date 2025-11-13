-- Enable realtime for user_tokens table
ALTER TABLE public.user_tokens REPLICA IDENTITY FULL;

-- Add to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_tokens;