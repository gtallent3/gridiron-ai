-- Fix search_path for trigger functions (security hardening)

-- 1. Fix update_updated_at_column() used by multiple tables
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 2. Fix update_subscriptions_updated_at()
CREATE OR REPLACE FUNCTION public.update_subscriptions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 3. Fix update_app_users_updated_at()
CREATE OR REPLACE FUNCTION public.update_app_users_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 4. Add data retention cleanup for risk_events (90-day retention)
CREATE OR REPLACE FUNCTION public.cleanup_old_risk_events()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete risk events older than 90 days
  DELETE FROM public.risk_events
  WHERE created_at < NOW() - INTERVAL '90 days';
  
  RAISE LOG 'Cleaned up risk_events older than 90 days';
END;
$$;

-- Grant execute permission to service role
GRANT EXECUTE ON FUNCTION public.cleanup_old_risk_events() TO service_role;