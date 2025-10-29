-- Fix search_path for trigger function
DROP FUNCTION IF EXISTS public.update_espn_credentials_updated_at() CASCADE;

CREATE OR REPLACE FUNCTION public.update_espn_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = public;