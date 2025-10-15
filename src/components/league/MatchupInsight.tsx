import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { PlayerCard } from "./PlayerCard";
import { Trophy, TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type League = {
  id: string;
  current_week?: number;
  opponent_team_id?: string;
};

type Team = {
  team_id: string;
  team_name: string;
  roster: any[];
  wins?: number;
  losses?: number;
  ties?: number;
  total_projected?: number;
} | null;

type MatchupInsightProps = {
  league: League;
  userTeam: Team;
};

export function MatchupInsight({ league, userTeam }: MatchupInsightProps) {
  const [opponentTeam, setOpponentTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOpponent = async () => {
      if (!league.opponent_team_id) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('user_teams')
        .select('*')
        .eq('league_id', league.id)
        .eq('team_id', league.opponent_team_id)
        .maybeSingle();

      if (!error && data) {
        setOpponentTeam({
          ...data,
          roster: Array.isArray(data.roster) ? data.roster : [],
        });
      }
      setLoading(false);
    };

    fetchOpponent();
  }, [league.id, league.opponent_team_id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!opponentTeam) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No matchup data available. Please sync your league to see matchup information.
        </CardContent>
      </Card>
    );
  }

  const userProjected = userTeam?.total_projected || 0;
  const opponentProjected = opponentTeam?.total_projected || 0;
  const totalProjected = userProjected + opponentProjected;
  const userWinProb = totalProjected > 0 ? Math.round((userProjected / totalProjected) * 100) : 50;
  const opponentWinProb = 100 - userWinProb;

  const userRecord = `${userTeam?.wins || 0}-${userTeam?.losses || 0}${userTeam?.ties ? `-${userTeam.ties}` : ''}`;
  const opponentRecord = `${opponentTeam?.wins || 0}-${opponentTeam?.losses || 0}${opponentTeam?.ties ? `-${opponentTeam.ties}` : ''}`;

  // Get top 3 projected players from opponent
  const opponentTopPlayers = (opponentTeam.roster || [])
    .filter((p: any) => p.projected > 0)
    .sort((a: any, b: any) => (b.projected || 0) - (a.projected || 0))
    .slice(0, 3)
    .map((p: any) => ({
      id: p.player_id,
      name: p.player_name,
      position: p.position,
      team: p.team,
      projected: p.projected,
    }));

  // Map ESPN position IDs to position strings
  const getPositionString = (position: any): string => {
    if (typeof position === 'string') {
      return position.toUpperCase();
    }
    
    // ESPN position ID mapping
    const espnPositionMap: Record<number, string> = {
      0: 'QB', 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 
      5: 'K', 16: 'DEF', 17: 'K', 23: 'FLEX'
    };
    
    return espnPositionMap[position] || 'FLEX';
  };

  // Calculate positional breakdowns - ONLY FOR STARTERS
  const getPositionalProjections = (roster: any[]) => {
    const positions: Record<string, number> = {
      QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0
    };
    
    // Filter to only include starters (slot 0-17, 23 for ESPN, starter=true for Sleeper)
    const STARTER_SLOTS = [0, 2, 4, 6, 16, 17, 23];
    
    roster.forEach((p: any) => {
      // Check if player is a starter
      const isStarter = STARTER_SLOTS.includes(p.slot) || p.starter === true;
      
      if (isStarter) {
        const pos = getPositionString(p.position);
        if (positions.hasOwnProperty(pos)) {
          positions[pos] += p.projected || 0;
        }
      }
    });
    
    return positions;
  };

  const userPositions = getPositionalProjections(userTeam?.roster || []);
  const oppPositions = getPositionalProjections(opponentTeam?.roster || []);

  return (
    <div className="space-y-6">
      {/* Win Probability */}
      <Card className="border-2 border-primary/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            Week {league.current_week || 1} Matchup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="text-center space-y-2">
              <p className="font-semibold text-lg">{userTeam?.team_name || "Your Team"}</p>
              <p className="text-muted-foreground text-sm">{userRecord}</p>
              <div className="flex items-center justify-center gap-2">
                {userProjected >= opponentProjected ? (
                  <TrendingUp className="h-5 w-5 text-green-500" />
                ) : (
                  <TrendingDown className="h-5 w-5 text-red-500" />
                )}
                <p className={`text-4xl font-bold ${userProjected >= opponentProjected ? 'text-green-500' : 'text-red-500'}`}>
                  {userWinProb}%
                </p>
              </div>
              <p className="text-2xl font-semibold text-primary">{userProjected.toFixed(1)} pts</p>
            </div>

            <div className="text-center space-y-2">
              <p className="font-semibold text-lg">{opponentTeam.team_name}</p>
              <p className="text-muted-foreground text-sm">{opponentRecord}</p>
              <div className="flex items-center justify-center gap-2">
                {opponentProjected > userProjected ? (
                  <TrendingUp className="h-5 w-5 text-green-500" />
                ) : (
                  <TrendingDown className="h-5 w-5 text-red-500" />
                )}
                <p className={`text-4xl font-bold ${opponentProjected > userProjected ? 'text-green-500' : 'text-red-500'}`}>
                  {opponentWinProb}%
                </p>
              </div>
              <p className="text-2xl font-semibold text-muted-foreground">{opponentProjected.toFixed(1)} pts</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Win Probability</span>
              <span>
                {userProjected > opponentProjected ? 'Favored' : 'Underdog'} by {Math.abs(userProjected - opponentProjected).toFixed(1)} points
              </span>
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
            {Object.keys(userPositions).map(position => {
              const you = userPositions[position];
              const opp = oppPositions[position];
              const advantage = you - opp;
              const isAdvantage = advantage > 0;
              const maxVal = Math.max(you, opp) || 1;
              const progressValue = (you / (you + opp)) * 100 || 50;
              
              return (
                <div key={position} className="flex items-center gap-4">
                  <Badge className="w-16 justify-center">{position}</Badge>
                  <div className="flex-1 flex items-center gap-3">
                    <div className="text-right w-16">
                      <p className="font-semibold">{you.toFixed(1)}</p>
                    </div>
                    <Progress 
                      value={progressValue} 
                      className="h-2 flex-1"
                    />
                    <div className="text-left w-16">
                      <p className="font-semibold text-muted-foreground">{opp.toFixed(1)}</p>
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
      {opponentTopPlayers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Opponent's Top Projected Players</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {opponentTopPlayers.map(player => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  readOnly
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
