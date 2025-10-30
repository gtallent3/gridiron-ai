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
    <div className="h-[260px] bg-muted/30 rounded-lg p-3 pointer-events-none overflow-hidden relative">
      <div className="space-y-1.5">
        {/* Side A */}
        <div
          className={`p-2.5 rounded-lg border transition-all duration-500 ${
            showResult
              ? "border-primary bg-primary/10 scale-[1.02]"
              : "border-border bg-card/50"
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              You Get
            </span>
            {showResult && (
              <Badge className="text-[10px] animate-fade-in bg-primary">
                Winner
              </Badge>
            )}
          </div>
          <div className="text-sm font-semibold">Josh Jacobs</div>
          <div className="text-[10px] text-muted-foreground">RB - GB</div>
        </div>

        {/* VS Divider */}
        <div className="flex items-center justify-center">
          <div className="h-px flex-1 bg-border" />
          <span className="px-3 text-[10px] text-muted-foreground font-semibold">FOR</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* Side B */}
        <div
          className={`p-2.5 rounded-lg border transition-all duration-500 space-y-1.5 ${
            showResult
              ? "border-border/30 bg-muted/20 opacity-60"
              : "border-border bg-card/50"
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              You Give
            </span>
          </div>
          <div>
            <div className="text-xs font-semibold">RJ Harvey</div>
            <div className="text-[10px] text-muted-foreground">RB - DEN</div>
          </div>
          <div className="pt-1.5 mt-1.5 border-t border-border/30">
            <div className="text-xs font-semibold">Michael Pittman Jr.</div>
            <div className="text-[10px] text-muted-foreground">WR - IND</div>
          </div>
        </div>
      </div>

      {showResult && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-background/10">
          <div className="bg-primary/95 text-primary-foreground px-4 py-2 rounded-lg text-sm font-bold animate-scale-in flex items-center gap-2 shadow-lg">
            <TrendingUp className="h-4 w-4" />
            Accept Trade
          </div>
        </div>
      )}

      <div className="absolute bottom-1.5 right-2 text-[10px] text-muted-foreground">
        AI Analysis
      </div>
    </div>
  );
};
