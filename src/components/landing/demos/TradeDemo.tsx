import { useState, useEffect } from "react";
import { TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type TradeDemoProps = {
  isHovered: boolean;
};

export const TradeDemo = ({ isHovered }: TradeDemoProps) => {
  const [showResult, setShowResult] = useState(false);

  useEffect(() => {
    if (!isHovered) {
      setShowResult(false);
      return;
    }

    const timeout = setTimeout(() => {
      setShowResult(true);
    }, 800);
    
    return () => clearTimeout(timeout);
  }, [isHovered]);

  return (
    <div className="h-[200px] bg-muted/30 rounded-lg p-4 pointer-events-none overflow-hidden relative">
      <div className="space-y-3">
        {/* Side A */}
        <div
          className={`p-3 rounded-lg border transition-all duration-500 ${
            showResult
              ? "border-primary bg-primary/10"
              : "border-border bg-card/50"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground">
              Side A
            </span>
            {showResult && (
              <Badge className="text-[10px] animate-fade-in bg-primary">
                Winner
              </Badge>
            )}
          </div>
          <div className="text-xs">Tyreek Hill</div>
          <div className="text-[10px] text-muted-foreground">WR - MIA</div>
        </div>

        {/* VS Divider */}
        <div className="text-center">
          <span className="text-xs text-muted-foreground font-semibold">VS</span>
        </div>

        {/* Side B */}
        <div
          className={`p-3 rounded-lg border transition-all duration-500 ${
            showResult
              ? "border-border/30 bg-muted/20 opacity-60"
              : "border-border bg-card/50"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground">
              Side B
            </span>
          </div>
          <div className="text-xs">DJ Moore</div>
          <div className="text-[10px] text-muted-foreground">WR - CHI</div>
        </div>
      </div>

      {showResult && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg text-xs font-bold animate-scale-in flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Side A Wins
          </div>
        </div>
      )}

      <div className="absolute bottom-2 right-2 text-[10px] text-muted-foreground">
        AI Analysis
      </div>
    </div>
  );
};
