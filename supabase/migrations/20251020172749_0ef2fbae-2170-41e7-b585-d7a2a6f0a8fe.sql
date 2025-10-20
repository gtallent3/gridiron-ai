-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule weekly player valuation sync (runs every Sunday at 3 AM UTC)
SELECT cron.schedule(
  'sync-player-valuations-weekly',
  '0 3 * * 0', -- Every Sunday at 3 AM UTC
  $$
  SELECT
    net.http_post(
        url:='https://zeklwogchobqttevcckl.supabase.co/functions/v1/sync-player-valuations',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpla2x3b2djaG9icXR0ZXZjY2tsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA0NDg3MTgsImV4cCI6MjA3NjAyNDcxOH0.0E92foO5BO3faPisjOwP8WTAsXpV-8aDW9-mWe0yOOc"}'::jsonb,
        body:=concat('{"time": "', now(), '"}')::jsonb
    ) as request_id;
  $$
);