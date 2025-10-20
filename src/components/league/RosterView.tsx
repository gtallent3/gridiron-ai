import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlayerCard } from "./PlayerCard";
import { StartSitRecommendations } from "./StartSitRecommendations";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type League = {
  id: string;
  platform: string;
  current_week?: number;
};

type Team = {
  roster: any;
} | null;

type RosterViewProps = {
  league: League;
  userTeam: Team;
};

// Position mapping for ESPN
const POSITION_MAP: Record<number, string> = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  16: 'DEF',
};

// Slot types for starters vs bench
const STARTER_SLOTS = [0, 2, 4, 6, 16, 17, 23];
const BENCH_SLOT = 20;

export function RosterView({ league, userTeam }: RosterViewProps) {
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [starters, setStarters] = useState<any[]>([]);
  const [bench, setBench] = useState<any[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<number>(league.current_week || 7);
  const [loading, setLoading] = useState(false);

  // Fetch historical stats for selected week
  const fetchWeeklyStats = async (week: number) => {
    if (!userTeam?.roster || !Array.isArray(userTeam.roster)) return;
    
    setLoading(true);
    try {
      // For historical weeks, fetch directly from ESPN
      const { data: weekScores, error } = await supabase.functions.invoke('get-espn-week-scores', {
        body: { week, leagueId: league.id }
      });

      if (error) throw error;

      if (!weekScores?.players) {
        console.error('No player data returned from ESPN');
        return;
      }

      const scoresMap = new Map(
        weekScores.players.map((p: any) => [p.player_id, p])
      );

      const starterPlayers: any[] = [];
      const benchPlayers: any[] = [];

      // Slot types for starters vs bench
      const STARTER_SLOTS = [0, 2, 4, 6, 16, 17, 23];
      const BENCH_SLOT = 20;

      userTeam.roster.forEach((player: any) => {
        const playerIdRaw = player.player_id ?? player.playerId ?? player.id;
        const playerId = String(playerIdRaw ?? '');
        const playerName = (player.player_name || player.playerName || player.name || 'Unknown Player') as string;
        
        let positionName = POSITION_MAP[player.position] || 'FLEX';
        let isStarter = STARTER_SLOTS.includes(player.slot);
        let isBench = player.slot === BENCH_SLOT;
        
        if (league.platform === 'sleeper') {
          positionName = player.position || 'FLEX';
          isStarter = player.starter !== false;
          isBench = player.starter === false;
        }

        // Get ESPN scores for this player (normalize to string id)
        let espnScore = scoresMap.get(playerId) as any;
        // Fallback: try name match if ID mapping fails
        if (!espnScore && playerName) {
          const lower = playerName.toLowerCase();
          espnScore = (weekScores.players as any[]).find((p: any) => p.player_name?.toLowerCase() === lower);
        }

        const playerData = {
          id: playerId || playerName, // ensure stable id for UI selection
          name: playerName,
          position: positionName,
          team: espnScore?.team || player.team || 'NFL',
          projected: espnScore?.projected_points ?? 0,
          actualPoints: espnScore?.actual_points ?? 0,
          status: isStarter ? 'starter' : 'bench',
          is_bye_week: espnScore?.is_bye_week ?? false,
          injury_status: espnScore?.injury_status ?? null,
          week: week,
        };

        if (isStarter) {
          starterPlayers.push(playerData);
        } else if (isBench) {
          benchPlayers.push(playerData);
        }
      });

      setStarters(starterPlayers);
      setBench(benchPlayers);
    } catch (err) {
      console.error('Error fetching week scores:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWeeklyStats(selectedWeek);
  }, [selectedWeek, userTeam, league.platform]);

  const handleWeekChange = (direction: 'prev' | 'next') => {
    setSelectedWeek(prev => {
      if (direction === 'prev' && prev > 1) return prev - 1;
      if (direction === 'next' && prev < 18) return prev + 1;
      return prev;
    });
  };

  const handlePlayerSelect = (playerId: string) => {
    setSelectedPlayers(prev => 
      prev.includes(playerId) 
        ? prev.filter(id => id !== playerId)
        : [...prev, playerId]
    );
  };

  const handleSubstitution = (starterId: string, benchId: string) => {
    const newStarters = [...starters];
    const newBench = [...bench];
    
    const starterIdx = newStarters.findIndex(p => p.id === starterId);
    const benchIdx = newBench.findIndex(p => p.id === benchId);
    
    if (starterIdx !== -1 && benchIdx !== -1) {
      const temp = newStarters[starterIdx];
      newStarters[starterIdx] = { ...newBench[benchIdx], status: 'starter' };
      newBench[benchIdx] = { ...temp, status: 'bench' };
      
      setStarters(newStarters);
      setBench(newBench);
    }
  };

  const totalProjected = starters.reduce((sum, p) => sum + p.projected, 0);
  const totalActual = starters.reduce((sum, p) => sum + (p.actualPoints || 0), 0);
  const currentWeek = league.current_week || 7;
  const isHistoricalWeek = selectedWeek < currentWeek;

  if (!userTeam) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <p>No team data available for this league.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Week Navigation */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleWeekChange('prev')}
              disabled={selectedWeek <= 1 || loading}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous Week
            </Button>
            
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Viewing Week</p>
                <Select 
                  value={String(selectedWeek)} 
                  onValueChange={(v) => setSelectedWeek(Number(v))}
                  disabled={loading}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: currentWeek }, (_, i) => i + 1).map(w => (
                      <SelectItem key={w} value={String(w)}>
                        Week {w}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {isHistoricalWeek && (
                <div className="text-sm px-3 py-1 bg-secondary rounded-md">
                  Historical Data
                </div>
              )}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => handleWeekChange('next')}
              disabled={selectedWeek >= currentWeek || loading}
            >
              Next Week
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {!isHistoricalWeek && (
        <StartSitRecommendations 
          starters={starters}
          bench={bench}
          onSubstitution={handleSubstitution}
        />
      )}

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Starting Lineup</CardTitle>
            <div className="text-right">
              {isHistoricalWeek ? (
                <>
                  <p className="text-sm text-muted-foreground">Actual Points Scored</p>
                  <p className="text-2xl font-bold text-primary">{totalActual.toFixed(1)}</p>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">Total Projected</p>
                  <p className="text-2xl font-bold text-primary">{totalProjected.toFixed(1)}</p>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-8 text-muted-foreground">Loading...</p>
          ) : starters.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No starters found</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {starters.map(player => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  isSelected={selectedPlayers.includes(player.id)}
                  onSelect={handlePlayerSelect}
                  showActual={isHistoricalWeek}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Bench</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-8 text-muted-foreground">Loading...</p>
          ) : bench.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No bench players found</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {bench.map(player => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  isSelected={selectedPlayers.includes(player.id)}
                  onSelect={handlePlayerSelect}
                  showActual={isHistoricalWeek}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
