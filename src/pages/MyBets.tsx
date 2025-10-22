import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/Header";
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
        <CardContent className="pt-6">
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-lg">{bet.prop.player_name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="secondary">{bet.prop.team}</Badge>
                  <Badge variant="outline">{bet.prop.stat_type}</Badge>
                </div>
              </div>
              {isPending && <Badge variant="default"><Clock className="h-3 w-3 mr-1" />Pending</Badge>}
              {isWon && <Badge className="bg-green-500"><CheckCircle className="h-3 w-3 mr-1" />Won</Badge>}
              {isLost && <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Lost</Badge>}
            </div>

            {/* Bet Details */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Selection</p>
                <p className="font-semibold flex items-center gap-1">
                  {bet.selection === "over" ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  {bet.selection.toUpperCase()} {bet.prop.line}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Wagered</p>
                <p className="font-semibold">{bet.tokens_wagered} tokens</p>
              </div>
              <div>
                <p className="text-muted-foreground">Multiplier</p>
                <p className="font-semibold">{bet.multiplier}x</p>
              </div>
              <div>
                <p className="text-muted-foreground">
                  {isPending ? "Potential" : isWon ? "Won" : "Lost"}
                </p>
                <p className={`font-semibold ${isWon ? "text-green-500" : isLost ? "text-red-500" : ""}`}>
                  {isPending ? bet.potential_payout : isWon ? bet.payout_amount : 0} tokens
                </p>
              </div>
            </div>

            {/* Result */}
            {!isPending && bet.prop.actual_value !== null && (
              <div className="pt-2 border-t">
                <p className="text-sm text-muted-foreground">
                  Actual Result: <span className="font-semibold text-foreground">{bet.prop.actual_value}</span>
                </p>
              </div>
            )}

            {/* Date */}
            <div className="pt-2 border-t text-xs text-muted-foreground">
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
    <div className="min-h-screen bg-background">
      <Header user={user} />
      
      <main className="container mx-auto px-4 pt-24 pb-12">
        <div className="max-w-6xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold">My Bets</h1>
            <p className="text-muted-foreground">View your betting history and active bets</p>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Active Bets</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{pendingBets.length}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Total Bets</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{bets.length}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {settledBets.length > 0 
                    ? `${Math.round((settledBets.filter(b => b.status === "settled_won").length / settledBets.length) * 100)}%`
                    : "N/A"}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Bets List */}
          <Tabs defaultValue="pending" className="space-y-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="pending">Active Bets ({pendingBets.length})</TabsTrigger>
              <TabsTrigger value="history">History ({settledBets.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="pending" className="space-y-4">
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

            <TabsContent value="history" className="space-y-4">
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
    </div>
  );
}
