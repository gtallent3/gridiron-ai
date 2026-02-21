import { useEffect, useRef } from "react";
import { DraftPick } from "@/hooks/useMockDraft";
import { cn } from "@/lib/utils";

const POS_COLORS: Record<string, string> = {
  QB: "bg-red-500/20 text-red-400 border-red-500/30",
  RB: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  WR: "bg-green-500/20 text-green-400 border-green-500/30",
  TE: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  K: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  DEF: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
};

interface DraftBoardProps {
  picks: DraftPick[];
  numTeams: number;
  numRounds: number;
  currentOverallPick: number;
  userSeat: number;
  getSeatForPick: (pick: number) => number;
  isActive: boolean;
}

export function DraftBoard({
  picks,
  numTeams,
  numRounds,
  currentOverallPick,
  userSeat,
  getSeatForPick,
  isActive,
}: DraftBoardProps) {
  const currentCellRef = useRef<HTMLTableCellElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to the current pick cell
  useEffect(() => {
    if (!isActive || !currentCellRef.current || !scrollContainerRef.current) return;

    const cell = currentCellRef.current;
    const container = scrollContainerRef.current;

    // Scroll vertically: keep current row roughly centered
    const cellTop = cell.offsetTop;
    const cellHeight = cell.offsetHeight;
    const containerHeight = container.clientHeight;
    const targetScrollTop = cellTop - containerHeight / 2 + cellHeight / 2;
    container.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: "smooth",
    });

    // Scroll horizontally: keep current column visible
    const cellLeft = cell.offsetLeft;
    const cellWidth = cell.offsetWidth;
    const containerWidth = container.clientWidth;
    const targetScrollLeft = cellLeft - containerWidth / 2 + cellWidth / 2;
    container.scrollTo({
      left: Math.max(0, targetScrollLeft),
      behavior: "smooth",
    });
  }, [currentOverallPick, isActive]);

  // Build a lookup: [round][seat] → pick
  const pickMap = new Map<string, DraftPick>();
  picks.forEach((p) => {
    pickMap.set(`${p.round}-${p.seatNumber}`, p);
  });

  return (
    <div className="overflow-auto max-h-full" ref={scrollContainerRef}>
      <table className="w-full border-collapse text-xs min-w-[600px]">
        <thead className="sticky top-0 z-10">
          <tr className="bg-card">
            <th className="p-1.5 text-muted-foreground border border-border/30 w-10 sticky left-0 bg-card z-20">
              Rd
            </th>
            {Array.from({ length: numTeams }, (_, i) => (
              <th
                key={i}
                className={cn(
                  "p-1.5 border border-border/30 text-center whitespace-nowrap",
                  i + 1 === userSeat
                    ? "text-primary font-bold bg-primary/10"
                    : "text-muted-foreground"
                )}
              >
                {i + 1 === userSeat ? "You" : `T${i + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: numRounds }, (_, roundIdx) => {
            const round = roundIdx + 1;

            return (
              <tr key={round}>
                <td className="p-1.5 text-center text-muted-foreground font-medium border border-border/30 sticky left-0 bg-card z-10">
                  {round}
                </td>
                {Array.from({ length: numTeams }, (_, colIdx) => {
                  const seat = colIdx + 1;
                  const pick = pickMap.get(`${round}-${seat}`);

                  // Calculate overall pick for this cell
                  const overallForCell = (round - 1) * numTeams + (round % 2 === 1 ? seat : numTeams - seat + 1);
                  const isCurrent = isActive && overallForCell === currentOverallPick;
                  const isUserCol = seat === userSeat;

                  return (
                    <td
                      key={colIdx}
                      ref={isCurrent ? currentCellRef : undefined}
                      className={cn(
                        "p-1 border border-border/30 min-w-[80px] h-9 relative",
                        isCurrent && "ring-2 ring-primary bg-primary/10",
                        !isCurrent && isUserCol && "bg-primary/5",
                        !isCurrent && !isUserCol && pick && "bg-secondary/20"
                      )}
                    >
                      {pick ? (
                        <div className="flex flex-col items-center">
                          <span className="font-medium truncate max-w-[75px] text-center leading-tight">
                            {pick.player.name.split(" ").pop()}
                          </span>
                          <span
                            className={cn(
                              "text-[10px] px-1 rounded mt-0.5",
                              POS_COLORS[pick.player.position] || "bg-secondary"
                            )}
                          >
                            {pick.player.position}
                          </span>
                        </div>
                      ) : isCurrent ? (
                        <div className="flex items-center justify-center">
                          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                        </div>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
