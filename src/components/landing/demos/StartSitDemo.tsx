import { useState, useEffect } from "react";
import { TrendingUp, User } from "lucide-react";

type StartSitDemoProps = {
  isHovered: boolean;
};

export const StartSitDemo = ({ isHovered }: StartSitDemoProps) => {
  const [showWinner, setShowWinner] = useState(false);

  useEffect(() => {
    if (!isHovered) {
      setShowWinner(false);
      return;
    }

    const timeout = setTimeout(() => {
      setShowWinner(true);
    }, 800);
    
    return () => clearTimeout(timeout);
  }, [isHovered]);

  return (
    <div className="h-[200px] bg-muted/30 rounded-lg p-4 pointer-events-none overflow-hidden relative">
      <div className="space-y-2">
        {/* Player 1 */}
        <div
          className={`flex items-center justify-between p-3 rounded-lg border transition-all duration-500 ${
            showWinner
              ? "border-primary bg-primary/10 scale-105"
              : "border-border bg-card/50"
          }`}
        >
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            <div>
              <div className="text-xs font-semibold">DK Metcalf</div>
              <div className="text-[10px] text-muted-foreground">WR - PIT</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs font-bold filter blur-[2px]">16.8</div>
            {showWinner && (
              <div className="text-[10px] text-primary font-bold animate-fade-in flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                START
              </div>
            )}
          </div>
        </div>

        {/* Player 2 */}
        <div
          className={`flex items-center justify-between p-3 rounded-lg border transition-all duration-500 ${
            !showWinner
              ? "border-border bg-card/50"
              : "border-border/30 bg-muted/20 opacity-60"
          }`}
        >
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-xs font-semibold">Michael Pittman Jr.</div>
              <div className="text-[10px] text-muted-foreground">WR - IND</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs font-bold filter blur-[2px]">13.4</div>
            {!showWinner && (
              <div className="text-[10px] text-muted-foreground font-bold animate-fade-in">
                SIT
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="absolute bottom-2 left-2 text-[10px] text-muted-foreground">
        Example comparison
      </div>
    </div>
  );
};
