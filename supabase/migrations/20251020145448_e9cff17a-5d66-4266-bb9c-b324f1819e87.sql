-- Move pg_cron from public schema to extensions schema (if it exists in public)
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension 
    WHERE extname = 'pg_cron' 
    AND extnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    ALTER EXTENSION pg_cron SET SCHEMA extensions;
  END IF;
END $$;

-- Ensure pg_cron exists in extensions schema
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;