import { DraftPick } from "@/hooks/useMockDraft";
import { cn } from "@/lib/utils";

const POS_COLORS: Record<string, string> = {
  QB: "bg-red-500/20 text-red-400",
  RB: "bg-blue-500/20 text-blue-400",
  WR: "bg-green-500/20 text-green-400",
  TE: "bg-orange-500/20 text-orange-400",
  K: "bg-purple-500/20 text-purple-400",
  DEF: "bg-yellow-500/20 text-yellow-400",
};

const POS_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];

interface DraftMyTeamProps {
  picks: DraftPick[];
}

export function DraftMyTeam({ picks }: DraftMyTeamProps) {
  const grouped = POS_ORDER.map((pos) => ({
    position: pos,
    players: picks.filter((p) => p.player.position === pos),
  })).filter((g) => g.players.length > 0);

  if (picks.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        No picks yet
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {grouped.map((group) => {
        const posClass = POS_COLORS[group.position] || "bg-secondary text-muted-foreground";
        return (
          <div key={group.position}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className={cn("text-xs font-semibold px-2 py-0.5 rounded", posClass)}>
                {group.position}
              </span>
              <span className="text-xs text-muted-foreground">({group.players.length})</span>
            </div>
            <div className="space-y-1">
              {group.players.map((pick) => (
                <div
                  key={pick.pickNumber}
                  className="flex items-center justify-between px-2 py-1.5 rounded bg-secondary/30 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{pick.player.name}</span>
                    <span className="text-xs text-muted-foreground">{pick.player.team}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Rd {pick.round}, Pick {pick.pickInRound}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
