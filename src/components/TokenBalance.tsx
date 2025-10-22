import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Coins, Infinity } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

export const TokenBalance = () => {
  const [balance, setBalance] = useState<number | null>(null);
  const [hasUnlimited, setHasUnlimited] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    fetchBalance();

    const channel = supabase
      .channel("token_balance_changes")
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
      if (!user) return;

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
      console.error("Error fetching token balance:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 bg-gradient-to-r from-amber-500/10 to-yellow-500/10 border-amber-500/30 hover:border-amber-500/50"
        >
          <Coins className="h-4 w-4 text-amber-400" />
          <span className="font-semibold text-amber-400">{balance ?? 0}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-4" align="end">
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Token Balance</span>
              <div className="flex items-center gap-1">
                <Coins className="h-5 w-5 text-amber-400" />
                <span className="font-bold text-xl text-amber-400">{balance ?? 0}</span>
              </div>
            </div>
            {hasUnlimited && (
              <div className="bg-primary/10 border border-primary/20 rounded-md p-2">
                <p className="text-xs font-medium text-primary flex items-center gap-1">
                  <Infinity className="h-3 w-3" />
                  Subscriber Benefits
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Unlimited access to AI tools (Trade Analyzer, Start/Sit, AI Chat) but still need tokens for prop betting
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2 pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              {hasUnlimited ? "Subscribers get:" : "Use tokens for:"}
            </p>
            <ul className="text-xs space-y-1 text-muted-foreground">
              {hasUnlimited ? (
                <>
                  <li>✓ AI Assistant (Free)</li>
                  <li>✓ Start/Sit Advice (Free)</li>
                  <li>✓ Trade Analysis (Free)</li>
                  <li>⚠️ Props Betting (Tokens Required)</li>
                </>
              ) : (
                <>
                  <li>• AI Assistant (1 token/question)</li>
                  <li>• Start/Sit Advice (1 token)</li>
                  <li>• Trade Analysis (1 token)</li>
                  <li>• Props Betting</li>
                </>
              )}
            </ul>
          </div>

          <Button
            onClick={() => navigate("/shop")}
            className="w-full bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-black font-semibold"
          >
            Get More Tokens
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
