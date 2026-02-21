import { useEffect, useState } from "react";
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

interface DraftPickBannerProps {
  pick: DraftPick | null;
}

export function DraftPickBanner({ pick }: DraftPickBannerProps) {
  const [visible, setVisible] = useState(false);
  const [currentPick, setCurrentPick] = useState<DraftPick | null>(null);

  useEffect(() => {
    if (!pick) return;
    setCurrentPick(pick);
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 2500);
    return () => clearTimeout(timer);
  }, [pick?.pickNumber]);

  if (!currentPick) return null;

  const posClass = POS_COLORS[currentPick.player.position] || "bg-secondary text-muted-foreground";

  return (
    <div
      className={cn(
        "fixed top-20 left-1/2 -translate-x-1/2 z-40 transition-all duration-300 pointer-events-none",
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4"
      )}
    >
      <div className="bg-card border border-border rounded-lg px-4 py-2 shadow-lg flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          Rd {currentPick.round}, Pick {currentPick.pickInRound}
        </span>
        <span className="text-muted-foreground">&mdash;</span>
        <span className="font-medium">Team {currentPick.seatNumber}:</span>
        <span className="font-bold">{currentPick.player.name}</span>
        <span className={cn("text-xs px-1.5 py-0.5 rounded", posClass)}>
          {currentPick.player.position}
        </span>
        <span className="text-muted-foreground text-xs">{currentPick.player.team}</span>
      </div>
    </div>
  );
}
