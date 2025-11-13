import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

export const useTokens = () => {
  const [balance, setBalance] = useState<number | null>(null);
  const [hasUnlimited, setHasUnlimited] = useState(false);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    fetchBalance();

    const channel = supabase
      .channel("token_updates")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_tokens",
        },
        () => {
          fetchBalance();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchBalance = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setBalance(null);
        setHasUnlimited(false);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("user_tokens")
        .select("balance, has_unlimited_subscription, subscription_expires_at")
        .eq("user_id", user.id)
        .single();

      if (error) throw error;

      const isUnlimitedActive =
        data.has_unlimited_subscription &&
        data.subscription_expires_at &&
        new Date(data.subscription_expires_at) > new Date();

      setHasUnlimited(isUnlimitedActive);
      setBalance(data.balance);
    } catch (error: any) {
      console.error("Error fetching balance:", error);
    } finally {
      setLoading(false);
    }
  };

  const deductToken = async (feature: string, description?: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({
          title: "Authentication Required",
          description: "Please sign in to use this feature",
          variant: "destructive",
        });
        navigate("/auth");
        return { success: false };
      }

      const { data, error } = await supabase.functions.invoke("deduct-token", {
        body: { feature, description },
      });

      if (error) throw error;

      if (data.insufficient) {
        toast({
          title: "Insufficient Tokens",
          description: "You need more tokens to use this feature. Click here to get more.",
          variant: "destructive",
        });
        setTimeout(() => navigate("/shop"), 2000);
        return { success: false };
      }

      if (!data.success) {
        throw new Error(data.error || "Failed to deduct token");
      }

      // Immediately reflect new balance locally and notify listeners (e.g., header counter)
      if (typeof data.balance === 'number' && data.balance >= 0) setBalance(data.balance);
      if (typeof data.unlimited === 'boolean') setHasUnlimited(data.unlimited);
      window.dispatchEvent(new CustomEvent('token-balance-updated', { detail: { balance: data.balance, unlimited: data.unlimited } }));

      return { success: true, balance: data.balance, unlimited: data.unlimited };
    } catch (error: any) {
      console.error("Error deducting token:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to process token",
        variant: "destructive",
      });
      return { success: false };
    }
  };

  const checkBalance = (required: number = 1): boolean => {
    if (hasUnlimited) return true;
    if (balance === null) return false;
    return balance >= required;
  };

  return {
    balance,
    hasUnlimited,
    loading,
    deductToken,
    checkBalance,
    refreshBalance: fetchBalance,
  };
};
