-- Fix search_path for security functions
CREATE OR REPLACE FUNCTION public.normalize_email(raw_email text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized text;
  local_part text;
  domain_part text;
BEGIN
  IF raw_email IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Trim and lowercase
  normalized := lower(trim(raw_email));
  
  -- Split into local and domain
  local_part := split_part(normalized, '@', 1);
  domain_part := split_part(normalized, '@', 2);
  
  -- Gmail special handling: remove dots and ignore plus addressing
  IF domain_part IN ('gmail.com', 'googlemail.com') THEN
    local_part := replace(split_part(local_part, '+', 1), '.', '');
  END IF;
  
  RETURN local_part || '@' || domain_part;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_old_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.signup_rate_limits
  WHERE window_start < now() - interval '48 hours';
END;
$$;