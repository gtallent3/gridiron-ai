import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface PositionalStrength {
  team_id: string;
  position: string;
  pss: number;
  rank: number;
  z_score: number;
  delta_vs_median: number;
  updated_at: string;
}

export function usePositionalStrengths(leagueId: string | null) {
  const [strengths, setStrengths] = useState<PositionalStrength[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (leagueId) {
      fetchStrengths();
    }
  }, [leagueId]);

  const fetchStrengths = async () => {
    if (!leagueId) return;

    try {
      const { data, error } = await supabase
        .from('team_positional_strengths')
        .select('*')
        .eq('league_id', leagueId);

      if (error) throw error;

      setStrengths(data || []);
      if (data && data.length > 0) {
        setLastUpdated(new Date(data[0].updated_at));
      }
    } catch (error) {
      console.error('Error fetching positional strengths:', error);
    }
  };

  const computeStrengths = async () => {
    if (!leagueId) return;

    try {
      setIsLoading(true);
      toast.info('Computing positional strengths...', { duration: 2000 });

      const { data, error } = await supabase.functions.invoke('compute-positional-strengths', {
        body: { leagueId },
      });

      if (error) throw error;

      toast.success(`Computed strengths for ${data.teamsProcessed} teams`);
      await fetchStrengths();
    } catch (error) {
      console.error('Error computing strengths:', error);
      toast.error('Failed to compute positional strengths');
    } finally {
      setIsLoading(false);
    }
  };

  return {
    strengths,
    isLoading,
    lastUpdated,
    computeStrengths,
    refetch: fetchStrengths,
  };
}
