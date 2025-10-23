import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PlayerData {
  player_id: string;
  player_name: string;
  team: string;
  position: string;
  week: number;
  season: number;
  stats: Record<string, number>;
  fantasy_points: number;
  points_breakdown: Record<string, number>;
  source: string;
  last_updated: string;
}

interface UsePlayerDataOptions {
  week?: number;
  season?: number;
  leagueId?: string;
  playerIds?: string[];
  enabled?: boolean;
}

export function usePlayerData(options: UsePlayerDataOptions = {}) {
  const [data, setData] = useState<PlayerData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const { week, season, leagueId, playerIds, enabled = true } = options;

  useEffect(() => {
    if (!enabled) return;

    const fetchPlayerData = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (week) params.append('week', week.toString());
        if (season) params.append('season', season.toString());
        if (leagueId) params.append('leagueId', leagueId);
        if (playerIds && playerIds.length > 0) params.append('playerIds', playerIds.join(','));

        const { data: result, error: invokeError } = await supabase.functions.invoke(
          'get-player-data',
          {
            body: {},
            method: 'GET',
          }
        );

        if (invokeError) {
          throw new Error(invokeError.message);
        }

        setData(result.players || []);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch player data'));
        console.error('Error fetching player data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchPlayerData();
  }, [week, season, leagueId, playerIds?.join(','), enabled]);

  const refetch = async () => {
    if (!enabled) return;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (week) params.append('week', week.toString());
      if (season) params.append('season', season.toString());
      if (leagueId) params.append('leagueId', leagueId);
      if (playerIds && playerIds.length > 0) params.append('playerIds', playerIds.join(','));

      const { data: result, error: invokeError } = await supabase.functions.invoke(
        'get-player-data',
        {
          body: {},
          method: 'GET',
        }
      );

      if (invokeError) {
        throw new Error(invokeError.message);
      }

      setData(result.players || []);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch player data'));
      console.error('Error fetching player data:', err);
    } finally {
      setLoading(false);
    }
  };

  return {
    data,
    loading,
    error,
    refetch,
  };
}
