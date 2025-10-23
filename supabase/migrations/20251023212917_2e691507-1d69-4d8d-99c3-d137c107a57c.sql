-- Schedule nightly projection refresh (2 AM ET = 6 AM UTC in winter, 7 AM UTC in summer)
-- Run every night at 6 AM UTC for next 2-3 weeks
SELECT cron.schedule(
  'refresh-espn-projections-nightly',
  '0 6 * * *', -- Daily at 6 AM UTC
  $$
  SELECT
    net.http_post(
      url := 'https://zeklwogchobqttevcckl.supabase.co/functions/v1/fetch-espn-projections',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpla2x3b2djaG9icXR0ZXZjY2tsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA0NDg3MTgsImV4cCI6MjA3NjAyNDcxOH0.0E92foO5BO3faPisjOwP8WTAsXpV-8aDW9-mWe0yOOc"}'::jsonb,
      body := jsonb_build_object(
        'leagueId', (SELECT id FROM connected_leagues LIMIT 1),
        'startWeek', EXTRACT(week FROM CURRENT_DATE)::integer,
        'endWeek', EXTRACT(week FROM CURRENT_DATE)::integer + 3
      )
    ) as request_id;
  $$
);

-- Schedule weekly full refresh (Tuesday 9 AM ET = 1 PM UTC in winter, 2 PM UTC in summer)
-- Run every Tuesday at 1 PM UTC for rest of season
SELECT cron.schedule(
  'refresh-espn-projections-weekly',
  '0 13 * * 2', -- Every Tuesday at 1 PM UTC
  $$
  SELECT
    net.http_post(
      url := 'https://zeklwogchobqttevcckl.supabase.co/functions/v1/fetch-espn-projections',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpla2x3b2djaG9icXR0ZXZjY2tsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA0NDg3MTgsImV4cCI6MjA3NjAyNDcxOH0.0E92foO5BO3faPisjOwP8WTAsXpV-8aDW9-mWe0yOOc"}'::jsonb,
      body := jsonb_build_object(
        'leagueId', (SELECT id FROM connected_leagues LIMIT 1),
        'startWeek', EXTRACT(week FROM CURRENT_DATE)::integer,
        'endWeek', 18
      )
    ) as request_id;
  $$
);