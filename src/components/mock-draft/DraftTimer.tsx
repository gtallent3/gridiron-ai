import { cn } from "@/lib/utils";

interface DraftTimerProps {
  timeRemaining: number;
  totalTime: number;
}

export function DraftTimer({ timeRemaining, totalTime }: DraftTimerProps) {
  if (totalTime === 0) return null;

  const pct = (timeRemaining / totalTime) * 100;
  const isWarning = timeRemaining <= 10 && timeRemaining > 5;
  const isCritical = timeRemaining <= 5;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">Time</span>
        <span
          className={cn(
            "text-sm font-mono font-bold",
            isCritical && "text-red-500 animate-pulse",
            isWarning && "text-yellow-500",
            !isWarning && !isCritical && "text-primary"
          )}
        >
          {timeRemaining}s
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-1000 ease-linear",
            isCritical && "bg-red-500",
            isWarning && "bg-yellow-500",
            !isWarning && !isCritical && "bg-primary"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
