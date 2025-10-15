import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Trophy, TrendingUp } from "lucide-react";

type League = {
  id: string;
  platform: string;
  league_name: string;
  league_size: number;
  scoring_type: string;
};

type Team = {
  team_name: string;
  roster: any;
} | null;

type LeagueHeaderProps = {
  league: League;
  userTeam: Team;
};

export function LeagueHeader({ league, userTeam }: LeagueHeaderProps) {
  // TODO: Fetch real team record and projections from league data
  const record = { wins: 0, losses: 0 }; // Will be updated with real data
  const projectedPoints = 0; // Will be calculated from roster
  const winProbability = 50; // Will be calculated based on matchup

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
              {record.wins > 0 || record.losses > 0 ? (
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-primary" />
                  <span className="font-semibold">
                    {record.wins}-{record.losses}
                  </span>
                </div>
              ) : (
                <span className="text-muted-foreground">Record not available</span>
              )}
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
