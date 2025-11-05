import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TrendingUp, TrendingDown, Trophy, Coins, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTokens } from "@/hooks/useTokens";
import { useNavigate } from "react-router-dom";

type Prop = {
  id: string;
  player_name: string;
  team: string;
  opponent: string | null;
  stat_type: string;
  line: number;
  over_multiplier: number;
  under_multiplier: number;
  week: number;
  season: number;
  game_time: string | null;
};

export default function Props() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { balance, hasUnlimited, checkBalance, deductToken } = useTokens();
  const [props, setProps] = useState<Prop[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProp, setSelectedProp] = useState<{ propId: string; selection: "over" | "under" } | null>(null);
  const [wagerAmount, setWagerAmount] = useState<number>(1);
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    fetchProps();
  }, []);

  const fetchProps = async () => {
    try {
      const { data, error } = await supabase
        .from("weekly_props")
        .select("*")
        .in("status", ["pending", "active"])
        .order("game_time", { ascending: true });

      if (error) throw error;
      setProps(data || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load props",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePlaceBet = async () => {
    if (!selectedProp) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate("/auth");
      return;
    }

    if (!checkBalance(wagerAmount)) {
      toast({
        title: "Insufficient Tokens",
        description: `You need ${wagerAmount} tokens to place this bet`,
        variant: "destructive",
      });
      return;
    }

    setPlacing(true);
    try {
      const prop = props.find(p => p.id === selectedProp.propId);
      if (!prop) throw new Error("Prop not found");

      const multiplier = selectedProp.selection === "over" ? prop.over_multiplier : prop.under_multiplier;
      const potentialPayout = Math.floor(wagerAmount * multiplier);

      // Deduct tokens
      const tokenResult = await deductToken(
        "prop_bet",
        `${prop.player_name} ${prop.stat_type} ${selectedProp.selection} ${prop.line}`
      );

      if (!tokenResult.success) {
        setPlacing(false);
        return;
      }

      // Place bet
      const { error } = await supabase.from("prop_bets").insert({
        user_id: user.id,
        prop_id: selectedProp.propId,
        selection: selectedProp.selection,
        tokens_wagered: wagerAmount,
        multiplier,
        potential_payout: potentialPayout,
      });

      if (error) throw error;

      toast({
        title: "Bet Placed!",
        description: `Wagered ${wagerAmount} tokens for a potential payout of ${potentialPayout} tokens`,
      });

      setSelectedProp(null);
      setWagerAmount(1);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to place bet",
        variant: "destructive",
      });
    } finally {
      setPlacing(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto py-8">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-4 sm:py-6 lg:py-8 px-4 sm:px-6 mt-16">
      <div className="max-w-7xl mx-auto spacing-mobile">
        {/* Header */}
        <div className="text-center spacing-mobile">
          <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full bg-primary/10 border border-primary/20">
            <Trophy className="h-4 w-4 text-primary" />
            <span className="text-xs sm:text-sm font-medium text-primary">Weekly Props</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold">PredictIQ</h1>
          <p className="text-muted-foreground text-base sm:text-lg max-w-2xl mx-auto px-4">
            No vig. No juice. 100% fair lines on player props
          </p>
        </div>

        {/* Token Balance Display */}
        <Card className="bg-gradient-to-r from-amber-500/10 to-yellow-500/10 border-amber-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  <Coins className="h-5 w-5 text-amber-400" />
                  Token Balance for Predictions
                </h3>
                <p className="text-sm text-muted-foreground">
                  {hasUnlimited 
                    ? `${balance || 0} tokens available (subscribers need tokens for predictions)` 
                    : `${balance || 0} tokens available`}
                </p>
              </div>
              <Button onClick={() => navigate("/shop")} variant="outline">
                Get More Tokens
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Props Grid */}
        {props.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No active props available. Check back later!
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {props.map((prop) => (
              <Card key={prop.id} className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/50 transition-colors">
                <CardHeader>
                  <div className="space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg">{prop.player_name}</CardTitle>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="text-xs">{prop.team}</Badge>
                          {prop.opponent && (
                            <span className="text-xs text-muted-foreground">vs {prop.opponent}</span>
                          )}
                        </div>
                      </div>
                      <Badge variant="outline">{prop.stat_type}</Badge>
                    </div>
                    {prop.game_time && (
                      <p className="text-xs text-muted-foreground">
                        {new Date(prop.game_time).toLocaleString()}
                      </p>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-center py-4 bg-secondary/50 rounded-lg">
                    <div className="text-3xl font-bold">{prop.line}</div>
                    <div className="text-sm text-muted-foreground">Line</div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      onClick={() => setSelectedProp({ propId: prop.id, selection: "over" })}
                      variant={selectedProp?.propId === prop.id && selectedProp.selection === "over" ? "default" : "outline"}
                      className="flex flex-col gap-1 h-auto py-3"
                    >
                      <TrendingUp className="h-5 w-5" />
                      <span className="font-semibold">Over</span>
                      <span className="text-xs">{prop.over_multiplier}x</span>
                    </Button>
                    <Button
                      onClick={() => setSelectedProp({ propId: prop.id, selection: "under" })}
                      variant={selectedProp?.propId === prop.id && selectedProp.selection === "under" ? "default" : "outline"}
                      className="flex flex-col gap-1 h-auto py-3"
                    >
                      <TrendingDown className="h-5 w-5" />
                      <span className="font-semibold">Under</span>
                      <span className="text-xs">{prop.under_multiplier}x</span>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Bet Slip */}
        {selectedProp && (
          <Card className="fixed bottom-0 left-0 right-0 sm:sticky sm:bottom-4 border-2 border-primary shadow-xl rounded-t-lg sm:rounded-lg z-40">
            <CardContent className="pt-4 sm:pt-6 pb-4 sm:pb-6">
              <div className="space-y-3 sm:space-y-4">
                <h3 className="font-semibold text-lg">Place Your Bet</h3>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium">Wager Amount (tokens)</label>
                  <Input
                    type="number"
                    min={1}
                    max={balance || 1}
                    value={wagerAmount}
                    onChange={(e) => setWagerAmount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="text-lg"
                  />
                </div>

                <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
                  <span className="text-sm text-muted-foreground">Potential Payout</span>
                  <span className="text-xl font-bold text-primary">
                    {Math.floor(wagerAmount * (selectedProp.selection === "over" 
                      ? props.find(p => p.id === selectedProp.propId)?.over_multiplier || 2
                      : props.find(p => p.id === selectedProp.propId)?.under_multiplier || 2))} tokens
                  </span>
                </div>

                <div className="flex gap-2 sm:gap-3">
                  <Button
                    onClick={() => setSelectedProp(null)}
                    variant="outline"
                    className="flex-1 touch-target"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handlePlaceBet}
                    disabled={placing || wagerAmount < 1}
                    className="flex-1 touch-target"
                  >
                    {placing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Placing...
                      </>
                    ) : (
                      <>
                        <Coins className="mr-2 h-4 w-4" />
                        Place Bet
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Info Section */}
        <Card className="bg-muted/50">
          <CardContent className="pt-6 space-y-4">
            <h3 className="font-semibold text-lg">How PredictIQ Works</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>✓ <strong>No Vig, No Juice:</strong> 100% fair multipliers on all props</li>
              <li>✓ <strong>Simple:</strong> Pick Over or Under, wager tokens, win big</li>
              <li>✓ <strong>Weekly Updates:</strong> Fresh props every Tuesday</li>
              <li>✓ <strong>Secure:</strong> Tokens cannot be transferred or sold</li>
              <li>✓ <strong>For Fun:</strong> No real money gambling involved</li>
              <li>⚠️ <strong>Note:</strong> All users (including subscribers) need tokens to place predictions</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
