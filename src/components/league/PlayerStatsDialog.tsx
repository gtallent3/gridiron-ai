import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

interface Player {
  id: string;
  name: string;
  position: string;
  team: string;
}

interface PlayerStatsDialogProps {
  player: Player | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  week: number;
  leagueId: string;
}

interface PlayerStats {
  fantasy_points: number;
  points_breakdown: Record<string, number>;
  stats: Record<string, number>;
  source_type: string;
  week: number;
  season: number;
}

export function PlayerStatsDialog({ player, open, onOpenChange, week, leagueId }: PlayerStatsDialogProps) {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!player || !open) {
      setStats(null);
      return;
    }

    const fetchStats = async () => {
      setLoading(true);
      try {
        const now = new Date();
        const season = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;

        const { data, error } = await supabase.functions.invoke('get-player-data', {
          body: {
            playerIds: [player.id],
            week,
            season,
            leagueId,
          },
        });

        if (error) throw error;
        
        if (data?.players && data.players.length > 0) {
          setStats(data.players[0]);
        }
      } catch (error) {
        console.error('Error fetching player stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [player, open, week, leagueId]);

  if (!player) return null;

  const statLabels: Record<string, string> = {
    passing_yards: "Pass Yds",
    passing_tds: "Pass TDs",
    interceptions: "INTs",
    rushing_yards: "Rush Yds",
    rushing_tds: "Rush TDs",
    receptions: "Rec",
    receiving_yards: "Rec Yds",
    receiving_tds: "Rec TDs",
    fg_made_0_19: "FG 0-19",
    fg_made_20_29: "FG 20-29",
    fg_made_30_39: "FG 30-39",
    fg_made_40_49: "FG 40-49",
    fg_made_50_plus: "FG 50+",
    xp_made: "XP Made",
    sacks: "Sacks",
    fumbles_recovered: "Fum Rec",
    fumbles_lost: "Fum Lost",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{player.name}</span>
            <div className="flex gap-2">
              <Badge variant="outline">{player.position}</Badge>
              <Badge variant="secondary">{player.team}</Badge>
            </div>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : stats ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Week {stats.week} • {stats.source_type === 'actual' ? 'Actual' : 'Projected'}
              </span>
              <span className="text-2xl font-bold">{stats.fantasy_points.toFixed(2)} pts</span>
            </div>

            <Separator />

            <div className="space-y-2">
              <h4 className="font-semibold text-sm">Stats</h4>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(stats.stats).map(([key, value]) => {
                  if (!value || !statLabels[key]) return null;
                  return (
                    <div key={key} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{statLabels[key]}</span>
                      <span className="font-medium">{value}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <h4 className="font-semibold text-sm">Points Breakdown</h4>
              <div className="space-y-1">
                {Object.entries(stats.points_breakdown).map(([key, value]) => {
                  if (!value) return null;
                  return (
                    <div key={key} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{statLabels[key] || key}</span>
                      <span className="font-medium">{value.toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No stats available for this player
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
