import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { PlayerCard } from "./PlayerCard";
import { Trophy, TrendingUp, TrendingDown } from "lucide-react";

type League = {
  id: string;
};

type Team = {
  team_name: string;
} | null;

type MatchupInsightProps = {
  league: League;
  userTeam: Team;
};

// Mock opponent data
const mockOpponent = {
  name: "The Gronk Squad",
  record: { wins: 4, losses: 3 },
  projectedPoints: 119.8,
  topPlayers: [
    { id: 'o1', name: 'Josh Allen', position: 'QB', team: 'BUF', projected: 26.3 },
    { id: 'o2', name: 'Derrick Henry', position: 'RB', team: 'BAL', projected: 19.5 },
    { id: 'o3', name: 'Amon-Ra St. Brown', position: 'WR', team: 'DET', projected: 17.8 },
  ]
};

export function MatchupInsight({ league, userTeam }: MatchupInsightProps) {
  const userProjected = 127.4;
  const opponentProjected = mockOpponent.projectedPoints;
  const totalProjected = userProjected + opponentProjected;
  const userWinProb = Math.round((userProjected / totalProjected) * 100);
  const opponentWinProb = 100 - userWinProb;

  return (
    <div className="space-y-6">
      {/* Win Probability */}
      <Card className="border-2 border-primary/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            Week 7 Matchup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="text-center space-y-2">
              <p className="font-semibold text-lg">{userTeam?.team_name || "Your Team"}</p>
              <p className="text-muted-foreground text-sm">5-2</p>
              <div className="flex items-center justify-center gap-2">
                <TrendingUp className="h-5 w-5 text-green-500" />
                <p className="text-4xl font-bold text-green-500">{userWinProb}%</p>
              </div>
              <p className="text-2xl font-semibold text-primary">{userProjected} pts</p>
            </div>

            <div className="text-center space-y-2">
              <p className="font-semibold text-lg">{mockOpponent.name}</p>
              <p className="text-muted-foreground text-sm">{mockOpponent.record.wins}-{mockOpponent.record.losses}</p>
              <div className="flex items-center justify-center gap-2">
                <TrendingDown className="h-5 w-5 text-red-500" />
                <p className="text-4xl font-bold text-red-500">{opponentWinProb}%</p>
              </div>
              <p className="text-2xl font-semibold text-muted-foreground">{opponentProjected} pts</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Win Probability</span>
              <span>Favored by {Math.abs(userProjected - opponentProjected).toFixed(1)} points</span>
            </div>
            <Progress value={userWinProb} className="h-3" />
          </div>
        </CardContent>
      </Card>

      {/* Positional Matchups */}
      <Card>
        <CardHeader>
          <CardTitle>Positional Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[
              { position: 'QB', you: 24.5, opp: 26.3 },
              { position: 'RB', you: 41.1, opp: 35.2 },
              { position: 'WR', you: 38.6, opp: 33.5 },
              { position: 'TE', you: 14.2, opp: 11.3 },
              { position: 'K', you: 9.5, opp: 8.7 },
              { position: 'DEF', you: 11.2, opp: 9.8 },
            ].map(pos => {
              const advantage = pos.you - pos.opp;
              const isAdvantage = advantage > 0;
              
              return (
                <div key={pos.position} className="flex items-center gap-4">
                  <Badge className="w-16 justify-center">{pos.position}</Badge>
                  <div className="flex-1 flex items-center gap-3">
                    <div className="text-right w-16">
                      <p className="font-semibold">{pos.you.toFixed(1)}</p>
                    </div>
                    <Progress 
                      value={50 + (advantage / 10) * 10} 
                      className="h-2 flex-1"
                    />
                    <div className="text-left w-16">
                      <p className="font-semibold text-muted-foreground">{pos.opp.toFixed(1)}</p>
                    </div>
                  </div>
                  <div className={`text-sm font-semibold w-16 text-right ${isAdvantage ? 'text-green-500' : 'text-red-500'}`}>
                    {isAdvantage ? '+' : ''}{advantage.toFixed(1)}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Opponent's Top Players */}
      <Card>
        <CardHeader>
          <CardTitle>Opponent's Top Projected Players</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {mockOpponent.topPlayers.map(player => (
              <PlayerCard
                key={player.id}
                player={player}
                readOnly
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
