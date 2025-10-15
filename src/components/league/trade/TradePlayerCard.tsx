import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

type Player = {
  id: string;
  name: string;
  position: string;
  team: string;
  projected: number;
  status?: string;
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
          <Badge className={cn("text-xs font-semibold", positionColors[player.position] || "")}>
            {player.position}
          </Badge>
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
          <p className="text-xs text-muted-foreground">Rest-of-Season</p>
          <p className="text-lg font-bold">
            {player.projected > 0 ? player.projected.toFixed(1) : 'N/A'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
