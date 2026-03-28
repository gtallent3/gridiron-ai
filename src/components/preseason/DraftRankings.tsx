import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search } from "lucide-react";

interface PlayerADP {
  name: string;
  position: string;
  team: string;
  adp: number;
  rank: number;
}

export function DraftRankings() {
  const [players, setPlayers] = useState<PlayerADP[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");

  useEffect(() => {
    fetchADPData();
  }, []);

  // Convert positional search_rank to overall ADP estimate
  const computeOverallAdp = (position: string, posRank: number): number => {
    switch (position) {
      case "RB": return posRank * 2.4 - 0.5;
      case "WR": return posRank * 2.4 + 0.8;
      case "QB": return posRank * 6.5 + 5;
      case "TE": return posRank * 11 + 2;
      case "K":  return 150 + posRank;
      case "DEF": return 140 + posRank;
      default: return 200 + posRank;
    }
  };

  const fetchADPData = async () => {
    try {
      const resp = await fetch("https://api.sleeper.app/v1/players/nfl");
      if (!resp.ok) throw new Error("Failed to fetch players");
      const data = await resp.json();

      // Group by position, sort within each group, then compute overall ADP
      const byPosition: Record<string, { name: string; team: string; posRank: number }[]> = {};
      for (const [, player] of Object.entries(data) as [string, any][]) {
        if (!player.active || !player.position || !player.search_rank) continue;
        if (!["QB", "RB", "WR", "TE", "K", "DEF"].includes(player.position)) continue;
        if (player.search_rank >= 9999) continue;

        const pos = player.position as string;
        if (!byPosition[pos]) byPosition[pos] = [];
        byPosition[pos].push({
          name: player.full_name || `${player.first_name} ${player.last_name}`,
          team: player.team || "FA",
          posRank: player.search_rank,
        });
      }

      const ranked: PlayerADP[] = [];
      for (const pos of Object.keys(byPosition)) {
        byPosition[pos].sort((a, b) => a.posRank - b.posRank);
        byPosition[pos].forEach((p, idx) => {
          const overallAdp = Math.round(computeOverallAdp(pos, idx + 1));
          ranked.push({
            name: p.name,
            position: pos,
            team: p.team,
            adp: overallAdp,
            rank: overallAdp,
          });
        });
      }

      ranked.sort((a, b) => a.rank - b.rank);
      setPlayers(ranked.slice(0, 300));
    } catch (err) {
      console.error("Failed to load ADP data:", err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = players.filter((p) => {
    if (posFilter !== "ALL" && p.position !== posFilter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Draft Rankings (ADP)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search player..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={posFilter} onValueChange={setPosFilter}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All</SelectItem>
              <SelectItem value="QB">QB</SelectItem>
              <SelectItem value="RB">RB</SelectItem>
              <SelectItem value="WR">WR</SelectItem>
              <SelectItem value="TE">TE</SelectItem>
              <SelectItem value="K">K</SelectItem>
              <SelectItem value="DEF">DEF</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 pr-3">Rank</th>
                  <th className="text-left py-2 pr-3">Player</th>
                  <th className="text-left py-2 pr-3">Pos</th>
                  <th className="text-left py-2">Team</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map((p, i) => (
                  <tr key={`${p.name}-${i}`} className="border-b border-border/50">
                    <td className="py-2 pr-3 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 pr-3 font-medium">{p.name}</td>
                    <td className="py-2 pr-3">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                        {p.position}
                      </span>
                    </td>
                    <td className="py-2 text-muted-foreground">{p.team}</td>
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
