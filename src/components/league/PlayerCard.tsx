import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Player = {
  id: string;
  name: string;
  position: string;
  team: string;
  projected: number;
  status?: string;
  changeImpact?: number; // For showing improvement/downgrade
  is_bye_week?: boolean;
  injury_status?: string | null;
  injury_duration_weeks?: number;
};

type PlayerCardProps = {
  player: Player;
  isSelected?: boolean;
  onSelect?: (playerId: string) => void;
  readOnly?: boolean;
};

export function PlayerCard({ player, isSelected, onSelect, readOnly }: PlayerCardProps) {
  const positionColors: Record<string, string> = {
    QB: "bg-red-500/10 text-red-500 border-red-500/20",
    RB: "bg-green-500/10 text-green-500 border-green-500/20",
    WR: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    TE: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    K: "bg-purple-500/10 text-purple-500 border-purple-500/20",
    DEF: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  };

  const handleClick = () => {
    if (!readOnly && onSelect) {
      onSelect(player.id);
    }
  };

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:shadow-lg",
        isSelected && "ring-2 ring-primary",
        player.changeImpact && player.changeImpact > 0 && "border-green-500/50 bg-green-500/5",
        player.changeImpact && player.changeImpact < 0 && "border-red-500/50 bg-red-500/5",
        readOnly && "cursor-default"
      )}
      onClick={handleClick}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex justify-between items-start">
          <Badge className={cn("text-xs font-semibold", positionColors[player.position] || "")}>
            {player.position}
          </Badge>
          {player.changeImpact && (
            <div className={cn(
              "flex items-center gap-1 text-xs font-semibold",
              player.changeImpact > 0 ? "text-green-500" : "text-red-500"
            )}>
              {player.changeImpact > 0 ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              {player.changeImpact > 0 ? '+' : ''}{player.changeImpact}
            </div>
          )}
        </div>

        <div>
          <h4 className="font-semibold text-sm leading-tight">{player.name}</h4>
          <p className="text-xs text-muted-foreground">{player.team}</p>
        </div>

        <div className="pt-2 border-t border-border/50">
          <p className="text-xs text-muted-foreground">Projected</p>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="text-lg font-bold cursor-help">
                  {player.projected > 0 
                    ? player.projected.toFixed(1) 
                    : player.is_bye_week 
                      ? '0 (Bye Week)' 
                      : player.injury_status 
                        ? '0 (Injured)'
                        : 'N/A'}
                </p>
              </TooltipTrigger>
              {(player.is_bye_week || player.injury_status) && (
                <TooltipContent>
                  {player.is_bye_week && <p>Player's team is on bye this week - no long-term impact</p>}
                  {player.injury_status && (
                    <div>
                      <p>Status: {player.injury_status}</p>
                      {player.injury_duration_weeks && player.injury_duration_weeks >= 4 && (
                        <p className="text-red-400">Long-term injury (4+ weeks)</p>
                      )}
                      {player.injury_duration_weeks && player.injury_duration_weeks >= 2 && player.injury_duration_weeks < 4 && (
                        <p className="text-orange-400">Medium-term injury (2-3 weeks)</p>
                      )}
                      {player.injury_duration_weeks && player.injury_duration_weeks === 1 && (
                        <p className="text-yellow-400">Short-term injury (~1 week)</p>
                      )}
                    </div>
                  )}
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardContent>
    </Card>
  );
}
