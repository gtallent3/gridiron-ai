import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface TrialEligibilityResult {
  eligible: boolean;
  reasons: string[];
  loading: boolean;
  error: string | null;
}

export function useTrialEligibility() {
  const [result, setResult] = useState<TrialEligibilityResult>({
    eligible: true,
    reasons: [],
    loading: false,
    error: null,
  });

  const checkEligibility = async (
    userId: string,
    phone?: string,
    paymentFingerprint?: string
  ): Promise<boolean> => {
    setResult({ eligible: true, reasons: [], loading: true, error: null });

    try {
      const { data, error } = await supabase.functions.invoke('check-trial-eligibility', {
        body: {
          user_id: userId,
          phone,
          payment_fingerprint: paymentFingerprint,
        },
      });

      if (error) {
        setResult({
          eligible: false,
          reasons: ['Error checking eligibility'],
          loading: false,
          error: error.message,
        });
        return false;
      }

      setResult({
        eligible: data.eligible,
        reasons: data.reasons || [],
        loading: false,
        error: null,
      });

      return data.eligible;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setResult({
        eligible: false,
        reasons: ['Error checking eligibility'],
        loading: false,
        error: errorMessage,
      });
      return false;
    }
  };

  return {
    ...result,
    checkEligibility,
  };
}
