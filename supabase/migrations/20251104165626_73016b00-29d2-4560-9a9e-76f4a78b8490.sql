-- Enrich league_transactions with trade and waiver details
ALTER TABLE league_transactions 
ADD COLUMN trade_partner TEXT,
ADD COLUMN faab_spent INTEGER,
ADD COLUMN comments TEXT,
ADD COLUMN player_names TEXT[];

-- Enrich roster_snapshots with dynasty and roster context
ALTER TABLE roster_snapshots 
ADD COLUMN age NUMERIC,
ADD COLUMN draft_year INTEGER,
ADD COLUMN draft_round INTEGER,
ADD COLUMN roster_status TEXT DEFAULT 'active',
ADD COLUMN team TEXT;

-- Create index for faster trade partner lookups
CREATE INDEX IF NOT EXISTS idx_league_transactions_trade_partner ON league_transactions(trade_partner);
CREATE INDEX IF NOT EXISTS idx_roster_snapshots_roster_status ON roster_snapshots(roster_status);