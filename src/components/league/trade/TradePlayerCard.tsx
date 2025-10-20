import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Player = {
  id: string;
  name: string;
  position: string;
  team: string;
  projected: number;
  ros_projection?: number;
  ppg_projection?: number;
  status?: string;
  is_bye_week?: boolean;
  injury_status?: string | null;
  injury_duration_weeks?: number;
};

type TradePlayerCardProps = {
  player: Player;
  isSelected: boolean;
  onToggle: (playerId: string) => void;
};

export function TradePlayerCard({ player, isSelected, onToggle }: TradePlayerCardProps) {
  const positionColors: Record<string, string> = {
    QB: "bg-red-500/10 text-red-500 border-red-500/20",
    RB: "bg-green-500/10 text-green-500 border-green-500/20",
    WR: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    TE: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    K: "bg-purple-500/10 text-purple-500 border-purple-500/20",
    DEF: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  };

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:shadow-lg relative",
        isSelected && "ring-2 ring-primary bg-primary/5"
      )}
      onClick={() => onToggle(player.id)}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex justify-between items-start">
          <div className="flex gap-1.5 flex-wrap">
            <Badge className={cn("text-xs font-semibold", positionColors[player.position] || "")}>
              {player.position}
            </Badge>
            {player.is_bye_week && (
              <Badge variant="secondary" className="text-xs font-semibold bg-gray-500/10 text-gray-500 border-gray-500/20">
                BYE
              </Badge>
            )}
            {player.injury_status && (
              <Badge 
                variant="secondary" 
                className={cn(
                  "text-xs font-semibold",
                  player.injury_status === 'Out' || player.injury_status === 'IR' 
                    ? "bg-red-500/10 text-red-500 border-red-500/20"
                    : player.injury_status === 'Questionable' 
                      ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/20"
                      : "bg-orange-500/10 text-orange-500 border-orange-500/20"
                )}
              >
                {player.injury_status === 'Out' ? 'OUT' : 
                 player.injury_status === 'IR' ? 'IR' : 
                 player.injury_status === 'Questionable' ? 'Q' : 
                 player.injury_status === 'Doubtful' ? 'D' : player.injury_status}
              </Badge>
            )}
          </div>
          <Checkbox 
            checked={isSelected} 
            onCheckedChange={() => onToggle(player.id)}
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        <div>
          <h4 className="font-semibold text-sm leading-tight">{player.name}</h4>
          <p className="text-xs text-muted-foreground">{player.team}</p>
        </div>

        <div className="pt-2 border-t border-border/50">
          <p className="text-xs text-muted-foreground">Rest-of-Season Projection</p>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="text-lg font-bold cursor-help">
                  {(player.ros_projection ?? 0) > 0 
                    ? (player.ros_projection ?? 0).toFixed(1) 
                    : player.is_bye_week 
                      ? 'BYE' 
                      : player.injury_status 
                        ? 'INJ'
                        : 'N/A'}
                </p>
              </TooltipTrigger>
              <TooltipContent>
                <div className="space-y-1">
                  <p>ROS Total: {(player.ros_projection ?? 0).toFixed(1)} pts</p>
                  <p>PPG: {(player.ppg_projection ?? 0).toFixed(1)} pts/game</p>
                  <p>This Week: {player.projected.toFixed(1)} pts</p>
                  {player.is_bye_week && <p className="text-yellow-400 mt-2">Team on bye this week</p>}
                  {player.injury_status && (
                    <div className="mt-2">
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
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardContent>
    </Card>
  );
}
