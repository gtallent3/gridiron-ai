import { useMemo } from "react";
import { DraftPlayer, DraftPick } from "@/hooks/useMockDraft";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";

const POS_COLORS: Record<string, string> = {
  QB: "bg-red-500/20 text-red-400",
  RB: "bg-blue-500/20 text-blue-400",
  WR: "bg-green-500/20 text-green-400",
  TE: "bg-orange-500/20 text-orange-400",
  K: "bg-purple-500/20 text-purple-400",
  DEF: "bg-yellow-500/20 text-yellow-400",
};

const POS_TARGETS: Record<string, number> = {
  QB: 2, RB: 5, WR: 5, TE: 2, K: 1, DEF: 1,
};

interface DraftRecommendationsProps {
  availablePlayers: DraftPlayer[];
  myPicks: DraftPick[];
  currentRound: number;
  onDraft: (player: DraftPlayer) => void;
}

function getReason(player: DraftPlayer, posCounts: Record<string, number>, currentRound: number): string {
  const count = posCounts[player.position] || 0;
  const target = POS_TARGETS[player.position] || 2;

  if (count === 0) return `First ${player.position} — fill a key need`;
  if (count < target - 1) return `Depth at ${player.position} (have ${count}/${target})`;
  if (currentRound <= 4) return `Elite value — don't wait`;
  if (currentRound >= 10 && (player.position === "K" || player.position === "DEF")) return `Good time to grab ${player.position}`;
  return `Strong ADP value at pick ${player.adp}`;
}

export function DraftRecommendations({
  availablePlayers,
  myPicks,
  currentRound,
  onDraft,
}: DraftRecommendationsProps) {
  const recommendations = useMemo(() => {
    const posCounts: Record<string, number> = {};
    myPicks.forEach((p) => {
      posCounts[p.player.position] = (posCounts[p.player.position] || 0) + 1;
    });

    const scored = availablePlayers.slice(0, 40).map((player) => {
      const count = posCounts[player.position] || 0;
      const target = POS_TARGETS[player.position] || 2;
      let score = player.adp;

      if (count >= target) score += 150;
      else if (count >= target - 1) score += 30;

      if ((player.position === "K" || player.position === "DEF") && currentRound < 10) {
        score += 200;
      }

      return { player, score };
    });

    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, 3).map(({ player }) => ({
      player,
      reason: getReason(player, posCounts, currentRound),
    }));
  }, [availablePlayers, myPicks, currentRound]);

  if (recommendations.length === 0) return null;

  return (
    <div className="mb-3 rounded-lg border border-primary/30 bg-primary/5 p-2.5">
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold text-primary">AI Suggestions</span>
      </div>
      <div className="space-y-1.5">
        {recommendations.map(({ player, reason }, i) => {
          const posClass = POS_COLORS[player.position] || "bg-secondary text-muted-foreground";
          return (
            <button
              key={player.name}
              onClick={() => onDraft(player)}
              className={cn(
                "w-full flex items-center justify-between rounded px-2 py-1.5 text-left transition-colors",
                "bg-secondary/40 hover:bg-secondary/70",
                i === 0 && "ring-1 ring-primary/40"
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium shrink-0", posClass)}>
                  {player.position}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{player.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{reason}</p>
                </div>
              </div>
              <span className="text-xs text-muted-foreground shrink-0 ml-2">ADP {player.adp}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
