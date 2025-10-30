-- Add ranking_unlock to token_transaction_type enum
ALTER TYPE token_transaction_type ADD VALUE IF NOT EXISTS 'ranking_unlock';