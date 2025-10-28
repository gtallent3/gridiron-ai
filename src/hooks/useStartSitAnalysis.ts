import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getCurrentNFLWeek } from '@/lib/nflWeekUtils';

export interface StartSitPlayer {
  name: string;
  team?: string;
  position?: string;
  projection?: number;
  injury_status?: string | null;
  eligible: boolean;
  ineligibilityReason?: string;
}

export interface StartSitAnalysis {
  success: boolean;
  week: number;
  season: number;
  recommendation: string;
  reasoning: string;
  confidence: number;
  player1: StartSitPlayer;
  player2: StartSitPlayer;
  lastUpdated: string;
}

export function useStartSitAnalysis() {
  const [analysis, setAnalysis] = useState<StartSitAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = async (player1Name: string, player2Name: string) => {
    setLoading(true);
    setError(null);
    setAnalysis(null);

    try {
      // Get current NFL week
      const { week, season, isOffseason } = getCurrentNFLWeek();

      if (isOffseason) {
        throw new Error('NFL season is currently inactive. Start/Sit analysis is only available during the regular season.');
      }

      // Call edge function
      const { data, error: invokeError } = await supabase.functions.invoke(
        'analyze-start-sit',
        {
          body: {
            player1Name: player1Name.trim(),
            player2Name: player2Name.trim(),
            week,
            season,
          },
        }
      );

      if (invokeError) {
        throw new Error(invokeError.message);
      }

      if (!data.success) {
        throw new Error(data.error || 'Analysis failed');
      }

      setAnalysis(data as StartSitAnalysis);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to analyze players';
      setError(errorMessage);
      console.error('Error analyzing start/sit:', err);
    } finally {
      setLoading(false);
    }
  };

  return {
    analysis,
    loading,
    error,
    analyze,
  };
}
