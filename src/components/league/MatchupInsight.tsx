import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { PlayerCard } from "./PlayerCard";
import { Trophy, TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { enrichRosterWithValuations } from "@/lib/enrichRoster";
import { calculateFantasyPoints, getScoringSettings } from "@/lib/fantasyPointsCalculator";

type League = {
  id: string;
  current_week?: number;
  opponent_team_id?: string;
  platform: string;
  scoring_type?: string;
  scoring_settings?: any;
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
  const [userProjected, setUserProjected] = useState(0);
  const [opponentProjected, setOpponentProjected] = useState(0);
  const [userPositions, setUserPositions] = useState<Record<string, number>>({});
  const [oppPositions, setOppPositions] = useState<Record<string, number>>({});

  useEffect(() => {
    const fetchAndCalculate = async () => {
      if (!league.opponent_team_id) {
        setLoading(false);
        return;
      }

      // Fetch opponent team
      const { data, error } = await supabase
        .from('user_teams')
        .select('*')
        .eq('league_id', league.id)
        .eq('team_id', league.opponent_team_id)
        .maybeSingle();

      if (error || !data) {
        setLoading(false);
        return;
      }

      const baseRoster = Array.isArray(data.roster) ? data.roster : [];
      const enrichedRoster = await enrichRosterWithValuations(baseRoster, { week: league.current_week || 12, season: 2025 });
      setOpponentTeam({
        ...data,
        roster: enrichedRoster,
      });

      // Now calculate projections for both teams
      await calculateProjections(userTeam, {
        ...data,
        roster: enrichedRoster,
      });

      setLoading(false);
    };

    fetchAndCalculate();
  }, [league.id, league.opponent_team_id, userTeam]);

  const calculateProjections = async (userTeamData: Team | null, oppTeamData: Team | null) => {
    if (!userTeamData || !oppTeamData || league.platform !== 'espn') {
      // For non-ESPN, use pre-calculated totals
      setUserProjected(userTeamData?.total_projected || 0);
      setOpponentProjected(oppTeamData?.total_projected || 0);
      return;
    }

    try {
      const currentWeek = league.current_week || 12;
      const season = 2025;

      // Get starters from both teams
      const STARTER_SLOTS = [0, 2, 4, 5, 6, 16, 17, 23];
      const userStarters = (userTeamData.roster || []).filter((p: any) => 
        STARTER_SLOTS.includes(p.slot) || p.starter === true
      );
      const oppStarters = (oppTeamData.roster || []).filter((p: any) => 
        STARTER_SLOTS.includes(p.slot) || p.starter === true
      );

      // Get ESPN IDs
      const userStarterIds = userStarters.map((p: any) => p.espn_id || p.player_id).filter(Boolean);
      const oppStarterIds = oppStarters.map((p: any) => p.espn_id || p.player_id).filter(Boolean);
      const allStarterIds = [...userStarterIds, ...oppStarterIds];

      if (allStarterIds.length === 0) {
        setUserProjected(userTeamData.total_projected || 0);
        setOpponentProjected(oppTeamData.total_projected || 0);
        return;
      }

      // Fetch canonical players
      const { data: canonicalPlayers } = await supabase
        .from('canonical_players')
        .select('id, espn_id, position')
        .in('espn_id', allStarterIds);

      if (!canonicalPlayers?.length) {
        setUserProjected(userTeamData.total_projected || 0);
        setOpponentProjected(oppTeamData.total_projected || 0);
        return;
      }

      const canonicalIds = canonicalPlayers.map(p => p.id);

      // Fetch player pool data - prioritize actual stats
      const { data: playerPoolData } = await supabase
        .from('player_pool_v2')
        .select('*')
        .in('canonical_player_id', canonicalIds)
        .eq('week', currentWeek)
        .eq('season', season)
        .order('actual_fp', { ascending: false, nullsFirst: false });

      if (!playerPoolData?.length) {
        setUserProjected(userTeamData.total_projected || 0);
        setOpponentProjected(oppTeamData.total_projected || 0);
        return;
      }

      // Create map, preferring actual stats over projected
      const poolMap = new Map<string, any>();
      for (const pool of playerPoolData) {
        const existing = poolMap.get(pool.canonical_player_id);
        if (!existing || (Number(pool.actual_fp) > 0 && Number(existing.actual_fp) === 0)) {
          poolMap.set(pool.canonical_player_id, pool);
        }
      }

      // Get league scoring settings
      const { data: leagueData } = await supabase
        .from('connected_leagues')
        .select('scoring_settings, scoring_type')
        .eq('id', league.id)
        .single();

      let scoringSettings: any = {
        passing_yards: 0.04, passing_tds: 4, interceptions: -2,
        rushing_yards: 0.1, rushing_tds: 6,
        receptions: 1, receiving_yards: 0.1, receiving_tds: 6,
        fumbles_lost: -2,
      };

      if (leagueData?.scoring_settings) {
        scoringSettings = { ...scoringSettings, ...(leagueData.scoring_settings as Record<string, any>) };
      } else if (leagueData?.scoring_type === 'standard') {
        scoringSettings.receptions = 0;
      } else if (leagueData?.scoring_type === 'half_ppr') {
        scoringSettings.receptions = 0.5;
      }

      // Create map from ESPN ID to canonical player and pool data
      const espnToData = new Map<string, { canonical: any, pool: any }>();
      canonicalPlayers.forEach(cp => {
        if (cp.espn_id) {
          const poolEntry = poolMap.get(cp.id);
          if (poolEntry) {
            espnToData.set(cp.espn_id, { canonical: cp, pool: poolEntry });
          }
        }
      });

      // Calculate user projected and positional breakdown
      let userTotal = 0;
      const userPosPoints: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
      
      userStarterIds.forEach(espnId => {
        const data = espnToData.get(espnId);
        if (data) {
          const { pool, canonical } = data;
          
          // Check if player has actual stats
          const hasActualStats = Number(pool.actual_fp) > 0;
          let points = 0;

          if (hasActualStats) {
            // Use actual stats
            const stats = {
              passing_yards: Number(pool.passing_yards) || 0,
              passing_tds: Number(pool.passing_tds) || 0,
              interceptions: Number(pool.passing_ints) || 0,
              rushing_yards: Number(pool.rushing_yards) || 0,
              rushing_tds: Number(pool.rushing_tds) || 0,
              receptions: Number(pool.receptions) || 0,
              receiving_yards: Number(pool.receiving_yards) || 0,
              receiving_tds: Number(pool.receiving_tds) || 0,
            };
            const { total } = calculateFantasyPoints(stats, scoringSettings);
            points = total;
          } else {
            // Use projected stats
            const stats = {
              passing_yards: Number(pool.passing_yards) || 0,
              passing_tds: Number(pool.passing_tds) || 0,
              interceptions: Number(pool.passing_ints) || 0,
              rushing_yards: Number(pool.rushing_yards) || 0,
              rushing_tds: Number(pool.rushing_tds) || 0,
              receptions: Number(pool.receptions) || 0,
              receiving_yards: Number(pool.receiving_yards) || 0,
              receiving_tds: Number(pool.receiving_tds) || 0,
            };
            const { total } = calculateFantasyPoints(stats, scoringSettings);
            points = total;
          }

          userTotal += points;
          
          // Add to positional breakdown
          const pos = canonical.position?.toUpperCase();
          if (userPosPoints.hasOwnProperty(pos)) {
            userPosPoints[pos] += points;
          }
        }
      });

      // Calculate opponent projected and positional breakdown
      let oppTotal = 0;
      const oppPosPoints: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
      
      oppStarterIds.forEach(espnId => {
        const data = espnToData.get(espnId);
        if (data) {
          const { pool, canonical } = data;
          
          // Check if player has actual stats
          const hasActualStats = Number(pool.actual_fp) > 0;
          let points = 0;

          if (hasActualStats) {
            // Use actual stats
            const stats = {
              passing_yards: Number(pool.passing_yards) || 0,
              passing_tds: Number(pool.passing_tds) || 0,
              interceptions: Number(pool.passing_ints) || 0,
              rushing_yards: Number(pool.rushing_yards) || 0,
              rushing_tds: Number(pool.rushing_tds) || 0,
              receptions: Number(pool.receptions) || 0,
              receiving_yards: Number(pool.receiving_yards) || 0,
              receiving_tds: Number(pool.receiving_tds) || 0,
            };
            const { total } = calculateFantasyPoints(stats, scoringSettings);
            points = total;
          } else {
            // Use projected stats
            const stats = {
              passing_yards: Number(pool.passing_yards) || 0,
              passing_tds: Number(pool.passing_tds) || 0,
              interceptions: Number(pool.passing_ints) || 0,
              rushing_yards: Number(pool.rushing_yards) || 0,
              rushing_tds: Number(pool.rushing_tds) || 0,
              receptions: Number(pool.receptions) || 0,
              receiving_yards: Number(pool.receiving_yards) || 0,
              receiving_tds: Number(pool.receiving_tds) || 0,
            };
            const { total } = calculateFantasyPoints(stats, scoringSettings);
            points = total;
          }

          oppTotal += points;
          
          // Add to positional breakdown
          const pos = canonical.position?.toUpperCase();
          if (oppPosPoints.hasOwnProperty(pos)) {
            oppPosPoints[pos] += points;
          }
        }
      });

      setUserProjected(userTotal);
      setOpponentProjected(oppTotal);
      setUserPositions(userPosPoints);
      setOppPositions(oppPosPoints);
    } catch (error) {
      console.error('Error calculating projections:', error);
      setUserProjected(userTeam?.total_projected || 0);
      setOpponentProjected(opponentTeam?.total_projected || 0);
    }
  };

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
      is_bye_week: p.is_bye_week || false,
      injury_status: p.injury_status || null,
      injury_duration_weeks: p.injury_duration_weeks || 0,
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
              const progressValue = (you + opp) > 0 ? (you / (you + opp)) * 100 : 50;
              
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
