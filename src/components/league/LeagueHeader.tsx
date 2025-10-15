import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Trophy, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type League = {
  id: string;
  platform: string;
  league_name: string;
  league_size: number;
  scoring_type: string;
  opponent_team_id?: string;
};

type Team = {
  team_name: string;
  roster: any;
  wins?: number;
  losses?: number;
  ties?: number;
  total_projected?: number;
} | null;

type LeagueHeaderProps = {
  league: League;
  userTeam: Team;
};

export function LeagueHeader({ league, userTeam }: LeagueHeaderProps) {
  const [winProbability, setWinProbability] = useState(50);

  useEffect(() => {
    const fetchWinProbability = async () => {
      if (!league.opponent_team_id) return;

      const { data: opponentTeam } = await supabase
        .from('user_teams')
        .select('total_projected')
        .eq('league_id', league.id)
        .eq('team_id', league.opponent_team_id)
        .maybeSingle();

      if (opponentTeam && userTeam?.total_projected) {
        const userProjected = userTeam.total_projected;
        const opponentProjected = opponentTeam.total_projected || 0;
        const totalProjected = userProjected + opponentProjected;
        const calculatedWinProb = totalProjected > 0 
          ? Math.round((userProjected / totalProjected) * 100) 
          : 50;
        setWinProbability(calculatedWinProb);
      }
    };

    fetchWinProbability();
  }, [league.id, league.opponent_team_id, userTeam?.total_projected]);

  // Compute projected points from the starting lineup using the same rules as RosterView
  const STARTER_SLOTS = [0, 2, 4, 6, 16, 17, 23];
  const projectedPoints = (() => {
    const roster = userTeam?.roster;
    if (!Array.isArray(roster)) return 0;

    if (league.platform === 'sleeper') {
      return roster
        .filter((p: any) => p.starter !== false)
        .reduce((sum: number, p: any) => sum + (p.projected || 0), 0);
    }

    return roster
      .filter((p: any) => STARTER_SLOTS.includes(p.slot))
      .reduce((sum: number, p: any) => sum + (p.projected || 0), 0);
  })();

  // Get actual team record from userTeam data
  const record = {
    wins: userTeam?.wins || 0,
    losses: userTeam?.losses || 0,
    ties: userTeam?.ties || 0
  };

  return (
    <Card className="border-2 border-primary/50 bg-gradient-to-r from-primary/5 to-accent/5">
      <CardContent className="p-6">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold">{league.league_name}</h1>
              <Badge variant="outline" className="uppercase">
                {league.platform}
              </Badge>
            </div>
            {userTeam && (
              <p className="text-xl text-muted-foreground">
                {userTeam.team_name}
              </p>
            )}
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-primary" />
                <span className="font-semibold">
                  {record.wins}-{record.losses}{record.ties ? `-${record.ties}` : ''}
                </span>
              </div>
              <span className="text-muted-foreground">•</span>
              <span className="text-muted-foreground">
                {league.league_size} Teams
              </span>
              <span className="text-muted-foreground">•</span>
              <span className="text-muted-foreground capitalize">
                {league.scoring_type.replace('_', ' ')}
              </span>
            </div>
          </div>

          <div className="flex gap-4">
            <Card className="bg-background/50">
              <CardContent className="p-4 text-center min-w-[140px]">
                <p className="text-sm text-muted-foreground mb-1">Projected Points</p>
                <p className="text-3xl font-bold text-primary">
                  {projectedPoints > 0 ? projectedPoints.toFixed(1) : 'N/A'}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-background/50">
              <CardContent className="p-4 text-center min-w-[140px]">
                <p className="text-sm text-muted-foreground mb-1">Win Probability</p>
                <div className="flex items-center justify-center gap-2">
                  <TrendingUp className="h-5 w-5 text-green-500" />
                  <p className="text-3xl font-bold text-green-500">{winProbability}%</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
