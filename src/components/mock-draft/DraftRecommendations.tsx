import { useMemo } from "react";
import { DraftPlayer, DraftPick } from "@/hooks/useMockDraft";
import {
  scorePlayer,
  getSuggestionReason,
  computeVOR,
  computeTiers,
  detectPositionalRuns,
} from "@/lib/draft-scoring";
import { cn } from "@/lib/utils";
import { Sparkles, AlertTriangle } from "lucide-react";

const POS_COLORS: Record<string, string> = {
  QB: "bg-red-500/20 text-red-400",
  RB: "bg-blue-500/20 text-blue-400",
  WR: "bg-green-500/20 text-green-400",
  TE: "bg-orange-500/20 text-orange-400",
  K: "bg-purple-500/20 text-purple-400",
  DEF: "bg-yellow-500/20 text-yellow-400",
};

interface DraftRecommendationsProps {
  availablePlayers: DraftPlayer[];
  myPicks: DraftPick[];
  allPicks: DraftPick[];
  currentRound: number;
  numTeams: number;
  onDraft: (player: DraftPlayer) => void;
}

export function DraftRecommendations({
  availablePlayers,
  myPicks,
  allPicks,
  currentRound,
  numTeams,
  onDraft,
}: DraftRecommendationsProps) {
  const runs = useMemo(() => detectPositionalRuns(allPicks), [allPicks]);

  const recommendations = useMemo(() => {
    const vorMap = computeVOR(availablePlayers, numTeams);
    const tierMap = computeTiers(availablePlayers);

    const ctx = {
      availablePlayers,
      teamPicks: myPicks,
      allPicks,
      currentRound,
      numTeams,
      archetype: "balanced" as const,
      vorMap,
      tierMap,
    };

    const scored = availablePlayers.slice(0, 40).map((player) => ({
      player,
      score: scorePlayer(player, ctx),
    }));

    scored.sort((a, b) => a.score - b.score);

    return scored.slice(0, 3).map(({ player }) => ({
      player,
      reason: getSuggestionReason(player, ctx),
    }));
  }, [availablePlayers, myPicks, allPicks, currentRound, numTeams]);

  if (recommendations.length === 0) return null;

  return (
    <div className="mb-3 rounded-lg border border-primary/30 bg-primary/5 p-2.5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold text-primary">AI Suggestions</span>
        </div>
        {runs.length > 0 && (
          <div className="flex items-center gap-1 text-xs text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            <span>{runs.map((r) => r.position).join(", ")} run</span>
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        {recommendations.map(({ player, reason }, i) => {
          const posClass = POS_COLORS[player.position] || "bg-secondary text-muted-foreground";
          const reasonColor =
            reason.tone === "urgent"
              ? "text-amber-400"
              : reason.tone === "value"
              ? "text-green-400"
              : "text-muted-foreground";

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
                  <p className={cn("text-xs truncate", reasonColor)}>{reason.text}</p>
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
