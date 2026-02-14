import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface KeeperCandidate {
  name: string;
  position: string;
  totalPoints: number;
  gamesPlayed: number;
  avgPoints: number;
  valueRating: "high" | "medium" | "low";
}

export function KeeperAnalysis() {
  const [keepers, setKeepers] = useState<KeeperCandidate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchKeeperData();
  }, []);

  const fetchKeeperData = async () => {
    try {
      // Get the user's leagues and roster players
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Get user's teams
      const { data: leagues } = await supabase
        .from("connected_leagues")
        .select("id")
        .eq("user_id", session.user.id);

      if (!leagues?.length) { setLoading(false); return; }

      const { data: teams } = await supabase
        .from("user_teams")
        .select("roster")
        .eq("league_id", leagues[0].id);

      if (!teams?.length) { setLoading(false); return; }

      const rosterNames = new Set<string>();
      const roster = Array.isArray(teams[0].roster) ? teams[0].roster : [];
      for (const p of roster) {
        const pAny = p as any;
        const name = pAny.player_name || pAny.name;
        if (name) rosterNames.add(name);
      }

      // Query historical performance from player_pool_v2
      const { data: poolData } = await supabase
        .from("player_pool_v2")
        .select("player_name, position, week, actual_fp")
        .eq("source", "nfl_actual")
        .gte("week", 1)
        .lte("week", 18);

      if (!poolData?.length) { setLoading(false); return; }

      // Aggregate by player (only roster players)
      const playerMap = new Map<string, { position: string; total: number; games: number }>();
      for (const row of poolData) {
        if (!rosterNames.has(row.player_name!)) continue;
        const existing = playerMap.get(row.player_name!) || { position: row.position || "??", total: 0, games: 0 };
        existing.total += row.actual_fp || 0;
        existing.games += 1;
        playerMap.set(row.player_name!, existing);
      }

      const candidates: KeeperCandidate[] = Array.from(playerMap.entries())
        .map(([name, data]) => {
          const avg = data.total / data.games;
          let valueRating: "high" | "medium" | "low" = "medium";
          if (avg >= 15) valueRating = "high";
          else if (avg < 8) valueRating = "low";

          return {
            name,
            position: data.position,
            totalPoints: Math.round(data.total * 10) / 10,
            gamesPlayed: data.games,
            avgPoints: Math.round(avg * 10) / 10,
            valueRating,
          };
        })
        .sort((a, b) => b.avgPoints - a.avgPoints);

      setKeepers(candidates);
    } catch (err) {
      console.error("Failed to fetch keeper data:", err);
    } finally {
      setLoading(false);
    }
  };

  const ValueIcon = ({ rating }: { rating: string }) => {
    if (rating === "high") return <TrendingUp className="h-4 w-4 text-green-400" />;
    if (rating === "low") return <TrendingDown className="h-4 w-4 text-red-400" />;
    return <Minus className="h-4 w-4 text-yellow-400" />;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Keeper Value Analysis</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : keepers.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No historical data available. Run backfill first to analyze keeper value.
          </p>
        ) : (
          <div className="max-h-[400px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 pr-3">Player</th>
                  <th className="text-left py-2 pr-3">Pos</th>
                  <th className="text-right py-2 pr-3">Avg</th>
                  <th className="text-right py-2 pr-3">Total</th>
                  <th className="text-center py-2">Value</th>
                </tr>
              </thead>
              <tbody>
                {keepers.map((k) => (
                  <tr key={k.name} className="border-b border-border/50">
                    <td className="py-2 pr-3 font-medium">{k.name}</td>
                    <td className="py-2 pr-3">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                        {k.position}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right">{k.avgPoints}</td>
                    <td className="py-2 pr-3 text-right text-muted-foreground">{k.totalPoints}</td>
                    <td className="py-2 text-center">
                      <ValueIcon rating={k.valueRating} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
