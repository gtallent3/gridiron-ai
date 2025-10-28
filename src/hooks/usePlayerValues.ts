import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface PlayerValue {
  player_id: string;
  player_name: string;
  position: string;
  team: string;
  value_score: number;
  projected_fp_ros: number;
  updated_at: string;
}

export function usePlayerValues(leagueId: string | null) {
  const [values, setValues] = useState<PlayerValue[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (leagueId) {
      fetchValues();
    }
  }, [leagueId]);

  const fetchValues = async () => {
    if (!leagueId) return;

    try {
      const { data, error } = await supabase
        .from('player_value_cache')
        .select('*')
        .eq('league_id', leagueId)
        .order('value_score', { ascending: false });

      if (error) throw error;

      setValues(data || []);
      if (data && data.length > 0) {
        setLastUpdated(new Date(data[0].updated_at));
      }
    } catch (error) {
      console.error('Error fetching player values:', error);
    }
  };

  const computeValues = async () => {
    if (!leagueId) return;

    try {
      setIsLoading(true);
      toast.info('Computing player values...', { duration: 2000 });

      const { data, error } = await supabase.functions.invoke('compute-player-values', {
        body: { leagueId },
      });

      if (error) throw error;

      toast.success(`Computed values for ${data.playersProcessed} players`);
      await fetchValues();
    } catch (error) {
      console.error('Error computing values:', error);
      toast.error('Failed to compute player values');
    } finally {
      setIsLoading(false);
    }
  };

  return {
    values,
    isLoading,
    lastUpdated,
    computeValues,
    refetch: fetchValues,
  };
}
