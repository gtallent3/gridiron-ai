import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TradePlayerCard } from "./TradePlayerCard";
import { cn } from "@/lib/utils";

type Player = {
  id: string;
  name: string;
  position: string;
  team: string;
  projected: number;
  ros_projection?: number;
  ppg_projection?: number;
  trade_value?: number;
  status?: string;
  is_bye_week?: boolean;
  injury_status?: string | null;
  injury_duration_weeks?: number;
};

type TradeRosterPanelProps = {
  teamName: string;
  teamRecord?: string;
  roster: Player[];
  selectedPlayers: string[];
  onPlayerToggle: (playerId: string) => void;
  side: "left" | "right";
};

export function TradeRosterPanel({
  teamName,
  teamRecord,
  roster,
  selectedPlayers,
  onPlayerToggle,
  side,
}: TradeRosterPanelProps) {
  const totalProjected = roster.reduce((sum, p) => sum + (p.ros_projection || p.projected || 0), 0);
  const selectedTotal = roster
    .filter(p => selectedPlayers.includes(p.id))
    .reduce((sum, p) => sum + (p.ros_projection || p.projected || 0), 0);

  // Group by position
  const groupedRoster = roster.reduce((acc, player) => {
    const pos = player.position;
    if (!acc[pos]) acc[pos] = [];
    acc[pos].push(player);
    return acc;
  }, {} as Record<string, Player[]>);

  const positionOrder = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  
  return (
    <Card className={cn(
      "flex-1",
      side === "left" ? "border-primary/50" : "border-muted"
    )}>
      <CardHeader className="pb-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{teamName}</CardTitle>
            {teamRecord && (
              <Badge variant="outline">{teamRecord}</Badge>
            )}
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Total ROS Projected</span>
            <span className="font-bold text-primary">{totalProjected.toFixed(1)} pts</span>
          </div>
          {selectedPlayers.length > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Selected ({selectedPlayers.length})</span>
              <span className="font-bold text-accent">{selectedTotal.toFixed(1)} pts</span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[600px] px-4 pb-4">
          <div className="space-y-4">
            {positionOrder.map(position => {
              const players = groupedRoster[position] || [];
              if (players.length === 0) return null;
              
              return (
                <div key={position} className="space-y-2">
                  <h4 className="font-semibold text-sm text-muted-foreground sticky top-0 bg-background py-1">
                    {position}
                  </h4>
                  <div className="space-y-2">
                    {players.map(player => (
                      <TradePlayerCard
                        key={player.id}
                        player={player}
                        isSelected={selectedPlayers.includes(player.id)}
                        onToggle={onPlayerToggle}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
