import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trophy, Medal, TrendingUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type LeaderboardEntry = {
  user_id: string;
  username: string;
  total_winnings: number;
  wins: number;
  losses: number;
  win_rate: number;
};

export default function Leaderboard() {
  const { toast } = useToast();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");

  useEffect(() => {
    checkAuth();
    fetchLeaderboard();
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    setUser(user);
  };

  const fetchLeaderboard = async () => {
    try {
      // Get start of current week (Sunday)
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 7);

      setWeekStart(startOfWeek.toLocaleDateString());
      setWeekEnd(endOfWeek.toLocaleDateString());

      // Fetch prop win transactions for this week
      const { data: transactions, error: txError } = await supabase
        .from("token_transactions")
        .select("user_id, amount, created_at")
        .eq("transaction_type", "prop_win")
        .gte("created_at", startOfWeek.toISOString())
        .lt("created_at", endOfWeek.toISOString());

      if (txError) throw txError;

      // Fetch all settled bets for this week to calculate win/loss records
      const { data: bets, error: betsError } = await supabase
        .from("prop_bets")
        .select("user_id, status, settled_at")
        .in("status", ["settled_won", "settled_lost"])
        .gte("settled_at", startOfWeek.toISOString())
        .lt("settled_at", endOfWeek.toISOString());

      if (betsError) throw betsError;

      // Aggregate data by user
      const userStats = new Map<string, { winnings: number; wins: number; losses: number }>();

      transactions?.forEach(tx => {
        const stats = userStats.get(tx.user_id) || { winnings: 0, wins: 0, losses: 0 };
        stats.winnings += tx.amount;
        userStats.set(tx.user_id, stats);
      });

      bets?.forEach(bet => {
        const stats = userStats.get(bet.user_id) || { winnings: 0, wins: 0, losses: 0 };
        if (bet.status === "settled_won") {
          stats.wins += 1;
        } else {
          stats.losses += 1;
        }
        userStats.set(bet.user_id, stats);
      });

      // Convert to array and sort by winnings
      const leaderboardData: LeaderboardEntry[] = Array.from(userStats.entries())
        .map(([user_id, stats]) => ({
          user_id,
          username: '', // Will be populated below
          total_winnings: stats.winnings,
          wins: stats.wins,
          losses: stats.losses,
          win_rate: stats.wins + stats.losses > 0 
            ? Math.round((stats.wins / (stats.wins + stats.losses)) * 100) 
            : 0,
        }))
        .sort((a, b) => b.total_winnings - a.total_winnings)
        .slice(0, 10); // Top 10

      // Fetch usernames for leaderboard entries
      if (leaderboardData.length > 0) {
        const userIds = leaderboardData.map(entry => entry.user_id);
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, username")
          .in("id", userIds);

        if (profiles) {
          leaderboardData.forEach(entry => {
            const profile = profiles.find(p => p.id === entry.user_id);
            entry.username = profile?.username || "Unknown User";
          });
        }
      }

      setLeaderboard(leaderboardData);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load leaderboard",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Trophy className="h-6 w-6 text-yellow-500" />;
      case 2:
        return <Medal className="h-6 w-6 text-gray-400" />;
      case 3:
        return <Medal className="h-6 w-6 text-amber-600" />;
      default:
        return <div className="w-6 h-6 flex items-center justify-center text-muted-foreground font-semibold">{rank}</div>;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <main className="container mx-auto px-4 pt-24 pb-12">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header */}
          <div className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20">
              <Trophy className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-primary">Weekly Leaderboard</span>
            </div>
            <h1 className="text-4xl font-bold">Top Token Winners</h1>
            <p className="text-muted-foreground">
              {weekStart} - {weekEnd}
            </p>
          </div>

          {/* Leaderboard */}
          <Card>
            <CardHeader>
              <CardTitle>This Week's Champions</CardTitle>
            </CardHeader>
            <CardContent>
              {leaderboard.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  No bets settled this week yet. Be the first!
                </div>
              ) : (
                <div className="space-y-3">
                  {leaderboard.map((entry, index) => (
                    <div
                      key={entry.user_id}
                      className={`flex items-center gap-4 p-4 rounded-lg border ${
                        index === 0 
                          ? "bg-gradient-to-r from-yellow-500/10 to-amber-500/10 border-yellow-500/30" 
                          : "bg-card border-border/50"
                      }`}
                    >
                      {/* Rank */}
                      <div className="flex-shrink-0 w-12 flex items-center justify-center">
                        {getRankIcon(index + 1)}
                      </div>

                      {/* User Info */}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">
                          {entry.username}
                          {entry.user_id === user?.id && (
                            <Badge variant="outline" className="ml-2">You</Badge>
                          )}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {entry.wins}W - {entry.losses}L ({entry.win_rate}%)
                        </p>
                      </div>

                      {/* Winnings */}
                      <div className="text-right">
                        <div className="flex items-center gap-1 text-green-500 font-bold text-lg">
                          <TrendingUp className="h-5 w-5" />
                          +{entry.total_winnings}
                        </div>
                        <p className="text-xs text-muted-foreground">tokens</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Info Card */}
          <Card className="bg-muted/50">
            <CardContent className="pt-6 space-y-2">
              <h3 className="font-semibold">How the Leaderboard Works</h3>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>• Rankings are based on total tokens won from prop bets this week</li>
                <li>• Week runs from Sunday to Saturday</li>
                <li>• Only settled bets count towards your total</li>
                <li>• Top 10 players are displayed</li>
              </ul>
            </CardContent>
          </Card>
        </div>
    </main>
  );
}
