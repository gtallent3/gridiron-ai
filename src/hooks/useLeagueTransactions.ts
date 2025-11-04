import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface Transaction {
  id: string;
  league_id: string;
  transaction_date: string;
  transaction_type: 'trade' | 'add' | 'drop' | 'waiver';
  teams_involved: Array<{ teamId: number }>;
  players_involved: Array<{
    playerId: number;
    type: string;
    fromTeamId?: number;
    toTeamId?: number;
  }>;
  raw_data: any;
  external_transaction_id: string;
  created_at: string;
  updated_at: string;
}

interface TransactionsResponse {
  success: boolean;
  count: number;
  transactions: Transaction[];
  metadata: {
    lastFetched: string;
    fetchCount: number;
    errorCount: number;
  };
}

interface UseLeagueTransactionsOptions {
  since?: string;
  type?: 'trade' | 'add' | 'drop' | 'waiver';
  limit?: number;
  enabled?: boolean;
}

export function useLeagueTransactions(
  leagueId: string | null,
  options: UseLeagueTransactionsOptions = {}
) {
  const { since, type, limit = 100, enabled = true } = options;

  return useQuery<TransactionsResponse>({
    queryKey: ['league-transactions', leagueId, since, type, limit],
    queryFn: async () => {
      if (!leagueId) throw new Error('League ID is required');

      const params = new URLSearchParams({
        leagueId,
        limit: limit.toString(),
      });

      if (since) params.append('since', since);
      if (type) params.append('type', type);

      const { data, error } = await supabase.functions.invoke(
        'get-league-transactions',
        {
          method: 'GET',
          body: { leagueId, since, type, limit },
        }
      );

      if (error) throw error;
      return data;
    },
    enabled: enabled && !!leagueId,
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
  });
}

// Hook for triggering manual sync
export function useSyncLeagueTransactions() {
  return async (leagueId: string) => {
    const { data, error } = await supabase.functions.invoke(
      'ingest-league-transactions',
      { body: { leagueId } }
    );

    if (error) {
      throw new Error(`Failed to sync transactions: ${error.message}`);
    }

    return data;
  };
}

// Hook for syncing rosters
export function useSyncLeagueRosters() {
  return async (leagueId: string) => {
    const { data, error } = await supabase.functions.invoke(
      'ingest-roster-snapshots',
      { body: { leagueId } }
    );

    if (error) {
      throw new Error(`Failed to sync rosters: ${error.message}`);
    }

    return data;
  };
}
