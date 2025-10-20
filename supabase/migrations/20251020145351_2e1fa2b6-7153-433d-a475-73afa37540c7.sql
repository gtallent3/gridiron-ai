-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enable pg_net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule weekly player valuation sync (every Monday at 2 AM UTC)
SELECT cron.schedule(
  'weekly-player-valuations-sync',
  '0 2 * * 1',
  $$
  SELECT
    net.http_post(
        url:='https://zeklwogchobqttevcckl.supabase.co/functions/v1/sync-player-valuations',
        headers:='{"Content-Type": "application/json"}'::jsonb,
        body:='{}'::jsonb
    ) as request_id;
  $$
);