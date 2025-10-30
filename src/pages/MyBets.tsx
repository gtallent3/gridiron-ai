import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, TrendingUp, TrendingDown, Clock, CheckCircle, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Bet = {
  id: string;
  prop_id: string;
  selection: string;
  tokens_wagered: number;
  multiplier: number;
  potential_payout: number;
  payout_amount: number | null;
  status: string;
  created_at: string;
  settled_at: string | null;
  prop: {
    player_name: string;
    team: string;
    stat_type: string;
    line: number;
    actual_value: number | null;
  };
};

export default function MyBets() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [bets, setBets] = useState<Bet[]>([]);

  useEffect(() => {
    checkAuthAndFetch();
  }, []);

  const checkAuthAndFetch = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      navigate("/auth");
      return;
    }

    setUser(user);
    await fetchBets(user.id);
    setLoading(false);
  };

  const fetchBets = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("prop_bets")
        .select(`
          *,
          prop:weekly_props!inner(
            player_name,
            team,
            stat_type,
            line,
            actual_value
          )
        `)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setBets(data || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load betting history",
        variant: "destructive",
      });
    }
  };

  const pendingBets = bets.filter(bet => bet.status === "pending");
  const settledBets = bets.filter(bet => bet.status === "settled_won" || bet.status === "settled_lost");

  const BetCard = ({ bet }: { bet: Bet }) => {
    const isWon = bet.status === "settled_won";
    const isLost = bet.status === "settled_lost";
    const isPending = bet.status === "pending";

    return (
      <Card className="border-border/50">
        <CardContent className="pt-4 sm:pt-6 p-3 sm:p-6">
          <div className="spacing-mobile">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-base sm:text-lg break-words">{bet.prop.player_name}</h3>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <Badge variant="secondary" className="text-xs">{bet.prop.team}</Badge>
                  <Badge variant="outline" className="text-xs">{bet.prop.stat_type}</Badge>
                </div>
              </div>
              <div className="shrink-0">
                {isPending && <Badge variant="default" className="text-xs"><Clock className="h-3 w-3 mr-1" />Pending</Badge>}
                {isWon && <Badge className="bg-green-500 text-xs"><CheckCircle className="h-3 w-3 mr-1" />Won</Badge>}
                {isLost && <Badge variant="destructive" className="text-xs"><XCircle className="h-3 w-3 mr-1" />Lost</Badge>}
              </div>
            </div>

            {/* Bet Details */}
            <div className="grid grid-cols-2 gap-3 sm:gap-4 text-xs sm:text-sm">
              <div>
                <p className="text-muted-foreground">Selection</p>
                <p className="font-semibold flex items-center gap-1 break-words">
                  {bet.selection === "over" ? <TrendingUp className="h-4 w-4 shrink-0" /> : <TrendingDown className="h-4 w-4 shrink-0" />}
                  {bet.selection.toUpperCase()} {bet.prop.line}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Wagered</p>
                <p className="font-semibold break-words">{bet.tokens_wagered} tokens</p>
              </div>
              <div>
                <p className="text-muted-foreground">Multiplier</p>
                <p className="font-semibold">{bet.multiplier}x</p>
              </div>
              <div>
                <p className="text-muted-foreground">
                  {isPending ? "Potential" : isWon ? "Won" : "Lost"}
                </p>
                <p className={`font-semibold break-words ${isWon ? "text-green-500" : isLost ? "text-red-500" : ""}`}>
                  {isPending ? bet.potential_payout : isWon ? bet.payout_amount : 0} tokens
                </p>
              </div>
            </div>

            {/* Result */}
            {!isPending && bet.prop.actual_value !== null && (
              <div className="pt-2 border-t">
                <p className="text-xs sm:text-sm text-muted-foreground break-words">
                  Actual Result: <span className="font-semibold text-foreground">{bet.prop.actual_value}</span>
                </p>
              </div>
            )}

            {/* Date */}
            <div className="pt-2 border-t text-xs text-muted-foreground break-words">
              Placed: {new Date(bet.created_at).toLocaleString()}
              {bet.settled_at && (
                <> • Settled: {new Date(bet.settled_at).toLocaleString()}</>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <main className="container mx-auto px-4 sm:px-6 pt-20 sm:pt-24 pb-8 sm:pb-12">
        <div className="max-w-6xl mx-auto spacing-mobile">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">My Bets</h1>
            <p className="text-sm sm:text-base text-muted-foreground">View your betting history and active bets</p>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <Card>
              <CardHeader className="pb-2 sm:pb-3 p-3 sm:p-6">
                <CardTitle className="text-xs sm:text-sm font-medium break-words">Active Bets</CardTitle>
              </CardHeader>
              <CardContent className="p-3 sm:p-6 pt-0">
                <div className="text-xl sm:text-2xl font-bold">{pendingBets.length}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 sm:pb-3 p-3 sm:p-6">
                <CardTitle className="text-xs sm:text-sm font-medium break-words">Total Bets</CardTitle>
              </CardHeader>
              <CardContent className="p-3 sm:p-6 pt-0">
                <div className="text-xl sm:text-2xl font-bold">{bets.length}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 sm:pb-3 p-3 sm:p-6">
                <CardTitle className="text-xs sm:text-sm font-medium break-words">Win Rate</CardTitle>
              </CardHeader>
              <CardContent className="p-3 sm:p-6 pt-0">
                <div className="text-xl sm:text-2xl font-bold">
                  {settledBets.length > 0 
                    ? `${Math.round((settledBets.filter(b => b.status === "settled_won").length / settledBets.length) * 100)}%`
                    : "N/A"}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Bets List */}
          <Tabs defaultValue="pending" className="spacing-mobile">
            <TabsList className="grid w-full grid-cols-2 h-auto">
              <TabsTrigger value="pending" className="text-xs sm:text-sm py-2 sm:py-3">
                <span className="hidden sm:inline">Active Bets ({pendingBets.length})</span>
                <span className="sm:hidden">Active ({pendingBets.length})</span>
              </TabsTrigger>
              <TabsTrigger value="history" className="text-xs sm:text-sm py-2 sm:py-3">
                <span className="hidden sm:inline">History ({settledBets.length})</span>
                <span className="sm:hidden">History ({settledBets.length})</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pending" className="spacing-mobile">
              {pendingBets.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    No active bets. Visit the <a href="/props" className="text-primary hover:underline">Props page</a> to place a bet!
                  </CardContent>
                </Card>
              ) : (
                pendingBets.map(bet => <BetCard key={bet.id} bet={bet} />)
              )}
            </TabsContent>

            <TabsContent value="history" className="spacing-mobile">
              {settledBets.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    No betting history yet.
                  </CardContent>
                </Card>
              ) : (
                settledBets.map(bet => <BetCard key={bet.id} bet={bet} />)
              )}
            </TabsContent>
          </Tabs>
        </div>
    </main>
  );
}
