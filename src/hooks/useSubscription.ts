import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface SubscriptionData {
  subscribed: boolean;
  product_id?: string;
  subscription_end?: string;
  status?: string;
  cancel_at_period_end?: boolean;
  trial_end?: string;
}

export function useSubscription() {
  const [subscription, setSubscription] = useState<SubscriptionData>({ subscribed: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkSubscription = async () => {
    try {
      setLoading(true);
      
      // Check if user is authenticated first
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setSubscription({ subscribed: false });
        setError(null);
        setLoading(false);
        return;
      }
      
      // The Supabase client automatically includes the Authorization header
      const { data, error } = await supabase.functions.invoke('check-subscription');
      
      if (error) throw error;
      
      setSubscription(data || { subscribed: false });
      setError(null);
    } catch (err) {
      console.error('Error checking subscription:', err);
      setError(err instanceof Error ? err.message : 'Failed to check subscription');
      setSubscription({ subscribed: false });
    } finally {
      setLoading(false);
    }
  };

  const openCustomerPortal = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('customer-portal');
      
      if (error) throw error;
      
      if (data?.url) {
        window.open(data.url, '_blank');
      }
    } catch (err) {
      throw err;
    }
  };

  const cancelSubscription = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('cancel-subscription');
      
      if (error) throw error;
      
      await checkSubscription();
      return data;
    } catch (err) {
      throw err;
    }
  };

  const resumeSubscription = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('resume-subscription');
      
      if (error) throw error;
      
      await checkSubscription();
      return data;
    } catch (err) {
      throw err;
    }
  };

  useEffect(() => {
    checkSubscription();

    // Auto-refresh every minute
    const interval = setInterval(checkSubscription, 60000);

    return () => clearInterval(interval);
  }, []);

  return {
    subscription,
    loading,
    error,
    checkSubscription,
    openCustomerPortal,
    cancelSubscription,
    resumeSubscription,
  };
}
