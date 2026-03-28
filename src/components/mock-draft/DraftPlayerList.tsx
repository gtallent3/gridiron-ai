import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import { DraftPlayer, DraftPick } from "@/hooks/useMockDraft";
import { cn } from "@/lib/utils";

const POS_TARGETS: Record<string, number> = {
  QB: 2, RB: 5, WR: 5, TE: 2, K: 1, DEF: 1,
};

const POS_COLORS: Record<string, string> = {
  QB: "bg-red-500/20 text-red-400",
  RB: "bg-blue-500/20 text-blue-400",
  WR: "bg-green-500/20 text-green-400",
  TE: "bg-orange-500/20 text-orange-400",
  K: "bg-purple-500/20 text-purple-400",
  DEF: "bg-yellow-500/20 text-yellow-400",
};

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"];

interface DraftPlayerListProps {
  players: DraftPlayer[];
  isUserTurn: boolean;
  onDraft: (player: DraftPlayer) => void;
  myPicks?: DraftPick[];
}

export function DraftPlayerList({ players, isUserTurn, onDraft, myPicks = [] }: DraftPlayerListProps) {
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");

  const posCounts: Record<string, number> = {};
  myPicks.forEach((p) => {
    posCounts[p.player.position] = (posCounts[p.player.position] || 0) + 1;
  });

  const getNeedLabel = (position: string) => {
    const count = posCounts[position] || 0;
    const target = POS_TARGETS[position] || 2;
    if (count === 0) return "need";
    if (count < target) return null;
    return "full";
  };

  const filtered = players.filter((p) => {
    if (posFilter !== "ALL" && p.position !== posFilter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      <div className="space-y-2 mb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search player..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {POSITIONS.map((pos) => (
            <button
              key={pos}
              onClick={() => setPosFilter(pos)}
              className={cn(
                "px-2 py-1 rounded text-xs font-medium transition-colors",
                posFilter === pos
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              {pos}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="border-b border-border text-muted-foreground text-xs">
              <th className="text-left py-1.5 pr-2 w-10">ADP</th>
              <th className="text-left py-1.5 pr-2">Player</th>
              <th className="text-left py-1.5 pr-2 w-12">Pos</th>
              <th className="text-left py-1.5 pr-2 w-12">Team</th>
              <th className="text-left py-1.5 pr-2 w-10">Bye</th>
              <th className="w-16"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 100).map((p) => {
              const posClass = POS_COLORS[p.position] || "bg-secondary text-muted-foreground";
              return (
                <tr key={p.name} className="border-b border-border/30 hover:bg-secondary/30">
                  <td className="py-1.5 pr-2 text-muted-foreground text-xs">{p.adp}</td>
                  <td className="py-1.5 pr-2 font-medium text-sm truncate max-w-[140px]">{p.name}</td>
                  <td className="py-1.5 pr-2">
                    <div className="flex flex-col gap-0.5">
                      <span className={cn("text-xs px-1.5 py-0.5 rounded", posClass)}>{p.position}</span>
                      {(() => {
                        const need = getNeedLabel(p.position);
                        if (need === "need") return <span className="text-[10px] text-primary font-medium leading-none">need</span>;
                        if (need === "full") return <span className="text-[10px] text-muted-foreground leading-none">full</span>;
                        return null;
                      })()}
                    </div>
                  </td>
                  <td className="py-1.5 pr-2 text-muted-foreground text-xs">{p.team}</td>
                  <td className="py-1.5 pr-2 text-muted-foreground text-xs">
                    {p.byeWeek ?? "—"}
                  </td>
                  <td className="py-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-xs px-2"
                      disabled={!isUserTurn}
                      onClick={() => onDraft(p)}
                    >
                      Draft
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
