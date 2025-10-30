import { useState, useEffect } from "react";
import { Coins, TrendingUp, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type PropsDemoProps = {
  isHovered: boolean;
};

export const PropsDemo = ({ isHovered }: PropsDemoProps) => {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!isHovered) {
      setPhase(0);
      return;
    }

    const timeouts: NodeJS.Timeout[] = [];
    
    // Show wager after 600ms
    timeouts.push(setTimeout(() => setPhase(1), 600));
    
    // Show potential win after 1400ms
    timeouts.push(setTimeout(() => setPhase(2), 1400));
    
    return () => timeouts.forEach(clearTimeout);
  }, [isHovered]);

  return (
    <div className="h-[200px] bg-muted/30 rounded-lg p-4 pointer-events-none overflow-hidden relative">
      <div className="space-y-3">
        {/* Player Prop */}
        <div className="p-3 rounded-lg border border-border bg-card/50">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-xs font-semibold">Saquon Barkley</div>
              <div className="text-[10px] text-muted-foreground">
                Touchdowns - Week 12
              </div>
            </div>
            <Badge variant="outline" className="text-[10px]">
              O/U 0.5
            </Badge>
          </div>
          
          {/* Betting Options */}
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div
              className={`p-2 rounded border text-center transition-all duration-300 ${
                phase === 1
                  ? "border-primary bg-primary/20"
                  : "border-border bg-background/50"
              }`}
            >
              <TrendingUp className="h-3 w-3 mx-auto mb-1 text-primary" />
              <div className="text-[10px] font-semibold">Over</div>
              <div className="text-[9px] text-muted-foreground">2.0x</div>
            </div>
            <div
              className={`p-2 rounded border text-center transition-all duration-300 ${
                phase === 1
                  ? "border-border bg-background/50"
                  : "border-border bg-background/50"
              }`}
            >
              <TrendingDown className="h-3 w-3 mx-auto mb-1 text-muted-foreground" />
              <div className="text-[10px] font-semibold">Under</div>
              <div className="text-[9px] text-muted-foreground">2.0x</div>
            </div>
          </div>
        </div>

        {/* Wager Display */}
        {phase >= 1 && (
          <div className="p-3 rounded-lg bg-primary/10 border border-primary/30 animate-fade-in">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Wager:</span>
              <div className="flex items-center gap-1 font-bold text-primary">
                <Coins className="h-3 w-3" />
                3 Tokens
              </div>
            </div>
            {phase === 2 && (
              <div className="flex items-center justify-between text-xs mt-2 pt-2 border-t border-primary/20 animate-fade-in">
                <span className="text-primary">Potential Win:</span>
                <div className="flex items-center gap-1 font-bold text-primary">
                  <Coins className="h-3 w-3" />
                  6 Tokens
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="absolute bottom-2 left-2 right-2">
        <div className="text-[9px] text-center text-muted-foreground">
          No vig. No cash. Just tokens.
        </div>
      </div>
    </div>
  );
};
