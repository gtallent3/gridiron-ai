# Fantasy League Data Ingestion Pipeline

## Overview

This system automatically fetches and normalizes fantasy league data (transactions, rosters, player stats) from ESPN leagues into our Supabase database for use in trade analysis and decision-making tools.

## Architecture

### Database Tables

**`league_transactions`** - Normalized trade and transaction history
- `league_id`: Foreign key to connected_leagues
- `transaction_type`: One of: trade, add, drop, waiver
- `teams_involved`: JSONB array of team IDs involved
- `players_involved`: JSONB array of player movements
- `raw_data`: Original ESPN API response

**`roster_snapshots`** - Historical roster data
- `league_id`, `team_id`, `player_id`: Core identifiers
- `snapshot_date`: When this snapshot was taken
- `position`, `is_starter`: Player context

**`fetch_metadata`** - Tracking for incremental fetches
- `league_id`, `endpoint_type`: What data was fetched
- `last_fetched_at`: Last successful fetch timestamp
- `fetch_count`, `error_count`: Success/failure tracking
- `last_error`: Last error message for debugging

### Edge Functions

#### `ingest-league-transactions`
**Purpose**: Fetch transaction history from ESPN for a single league
**Trigger**: Called every 30 minutes via cron or on-demand
**Input**: `{ leagueId: UUID }`
**Output**: `{ transactionsProcessed: number, lastFetchTime: ISO string }`

**How it works**:
1. Gets ESPN credentials for the league
2. Fetches transactions since last fetch time (or last 90 days if first run)
3. Normalizes ESPN transaction data into our schema
4. Upserts into `league_transactions` (deduplication by external_transaction_id)
5. Updates `fetch_metadata` with success/error info

#### `ingest-roster-snapshots`
**Purpose**: Capture current roster state for all teams in a league
**Trigger**: Called daily at 03:00 UTC
**Input**: `{ leagueId: UUID }`
**Output**: `{ rosterEntriesProcessed: number, teamsProcessed: number }`

**How it works**:
1. Fetches current rosters from ESPN
2. Creates snapshot entries for each player on each team
3. Inserts into `roster_snapshots` (no deduplication - each snapshot is unique)
4. Updates `fetch_metadata`

#### `get-league-transactions`
**Purpose**: Query endpoint for frontend to retrieve transaction history
**Authentication**: Required (user must own the league)
**Input**: Query params:
  - `leagueId` (required)
  - `since` (optional): ISO date to filter from
  - `type` (optional): Filter by transaction type
  - `limit` (optional): Max results (default 100)

**Output**: `{ transactions: array, metadata: object }`

#### `auto-ingest-all-leagues`
**Purpose**: Scheduled job to process all connected leagues
**Trigger**: Every 30 minutes via pg_cron
**Authentication**: None required (public endpoint)

**How it works**:
1. Queries all connected leagues with `auto_refresh = true`
2. For each league:
   - Calls `ingest-league-transactions`
   - Checks if rosters need updating (23+ hours since last)
   - Calls `ingest-roster-snapshots` if needed
3. Tracks error counts and logs leagues failing repeatedly
4. Returns summary: `{ total, successful, failed, errors }`

## Scheduling

### Setup pg_cron for automated fetching:

```sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule every 30 minutes to fetch transactions
SELECT cron.schedule(
  'auto-ingest-leagues',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url:='https://zeklwogchobqttevcckl.supabase.co/functions/v1/auto-ingest-all-leagues',
    headers:='{"Content-Type": "application/json"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;
  $$
);

-- View scheduled jobs
SELECT * FROM cron.job;

-- View job run history
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
```

## Frontend Integration

### React Hook Example

```typescript
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useLeagueTransactions(leagueId: string, since?: string) {
  return useQuery({
    queryKey: ['league-transactions', leagueId, since],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        'get-league-transactions',
        {
          body: {
            leagueId,
            since,
            limit: 100,
          },
        }
      );
      
      if (error) throw error;
      return data;
    },
  });
}
```

### Trigger Manual Sync

```typescript
const triggerSync = async (leagueId: string) => {
  const { data, error } = await supabase.functions.invoke(
    'ingest-league-transactions',
    { body: { leagueId } }
  );
  
  if (error) {
    toast.error('Failed to sync transactions');
  } else {
    toast.success(`Synced ${data.transactionsProcessed} transactions`);
  }
};
```

## Integration with Trade Analyzer

The transaction and roster data feeds into the trade evaluation pipeline:

1. **Historical Trade Analysis**: `league_transactions` provides past trade patterns for the league
2. **Positional Needs**: `roster_snapshots` shows team composition over time
3. **Market Activity**: Transaction frequency indicates league trading culture
4. **Player Ownership**: Roster snapshots track who owns which players

Example query for trade context:
```sql
-- Get recent trades involving a specific player
SELECT * FROM league_transactions
WHERE league_id = $1
  AND transaction_type = 'trade'
  AND players_involved @> '[{"playerId": "12345"}]'::jsonb
ORDER BY transaction_date DESC
LIMIT 10;

-- Get current roster for a team
SELECT * FROM roster_snapshots
WHERE league_id = $1
  AND team_id = $2
  AND snapshot_date = (
    SELECT MAX(snapshot_date) 
    FROM roster_snapshots 
    WHERE league_id = $1
  );
```

## Error Handling & Monitoring

- **Error Tracking**: Each failed fetch increments `error_count` in `fetch_metadata`
- **Alerting**: When `error_count >= 3`, system logs a warning (can be extended to webhook/Slack)
- **Manual Retry**: Users can trigger manual sync from UI if auto-sync fails
- **Logging**: All edge functions log structured JSON for debugging

## Maintenance

### Clean up old snapshots (optional)
```sql
-- Delete roster snapshots older than 90 days
DELETE FROM roster_snapshots
WHERE snapshot_date < NOW() - INTERVAL '90 days';

-- Keep only the most recent snapshot per day per team
DELETE FROM roster_snapshots rs1
WHERE EXISTS (
  SELECT 1 FROM roster_snapshots rs2
  WHERE rs2.league_id = rs1.league_id
    AND rs2.team_id = rs1.team_id
    AND DATE(rs2.snapshot_date) = DATE(rs1.snapshot_date)
    AND rs2.snapshot_date > rs1.snapshot_date
);
```

### Monitor fetch health
```sql
-- Check leagues with high error rates
SELECT 
  cl.league_name,
  fm.endpoint_type,
  fm.error_count,
  fm.last_error,
  fm.last_fetched_at
FROM fetch_metadata fm
JOIN connected_leagues cl ON cl.id = fm.league_id
WHERE fm.error_count >= 2
ORDER BY fm.error_count DESC;
```

## Future Enhancements

- [ ] Support for Sleeper and Yahoo platforms
- [ ] Webhook notifications for high-impact trades
- [ ] Machine learning models trained on transaction patterns
- [ ] Real-time updates via WebSocket instead of polling
- [ ] Transaction impact analysis (before/after team strength)
