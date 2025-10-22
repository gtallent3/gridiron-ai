-- Add INSERT policy for normalized_players table
-- This allows authenticated users (typically admin-controlled sync operations) to insert player data
CREATE POLICY "Service can insert normalized players"
  ON normalized_players FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Add rate limiting table for AI operations
CREATE TABLE IF NOT EXISTS public.ai_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint, window_start)
);

-- Enable RLS on rate limits table
ALTER TABLE public.ai_rate_limits ENABLE ROW LEVEL SECURITY;

-- Users can view their own rate limit data
CREATE POLICY "Users can view their own rate limits"
  ON public.ai_rate_limits FOR SELECT
  USING (auth.uid() = user_id);

-- Service can manage rate limits
CREATE POLICY "Service can manage rate limits"
  ON public.ai_rate_limits FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Function to check and increment rate limit
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id uuid,
  p_endpoint text,
  p_max_requests integer,
  p_window_minutes integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start timestamptz;
  v_request_count integer;
  v_allowed boolean;
BEGIN
  -- Calculate current window start (round down to window_minutes)
  v_window_start := date_trunc('minute', now()) - 
    (EXTRACT(minute FROM now())::integer % p_window_minutes || ' minutes')::interval;
  
  -- Get or create rate limit record
  INSERT INTO public.ai_rate_limits (user_id, endpoint, window_start, request_count)
  VALUES (p_user_id, p_endpoint, v_window_start, 1)
  ON CONFLICT (user_id, endpoint, window_start)
  DO UPDATE SET 
    request_count = ai_rate_limits.request_count + 1
  RETURNING request_count INTO v_request_count;
  
  -- Check if within limit
  v_allowed := v_request_count <= p_max_requests;
  
  -- Clean up old records (older than 1 hour)
  DELETE FROM public.ai_rate_limits 
  WHERE window_start < now() - interval '1 hour';
  
  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'request_count', v_request_count,
    'max_requests', p_max_requests,
    'window_minutes', p_window_minutes,
    'reset_at', v_window_start + (p_window_minutes || ' minutes')::interval
  );
END;
$$;