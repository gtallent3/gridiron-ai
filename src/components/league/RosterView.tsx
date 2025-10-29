import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlayerCard } from "./PlayerCard";
import { StartSitRecommendations } from "./StartSitRecommendations";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PlayerStatsDialog } from "./PlayerStatsDialog";
import { getCurrentNFLWeek } from "@/lib/nflWeekUtils";
import { isTeamOnBye } from "@/lib/byeWeekSchedule";

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
  const [selectedWeek, setSelectedWeek] = useState<number>(league.current_week || getCurrentNFLWeek().week);
  const [providerCurrentWeek, setProviderCurrentWeek] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<any>(null);
  const [statsDialogOpen, setStatsDialogOpen] = useState(false);
  const hasAutoSetSelectedWeek = useRef(false);

  // Fetch stats with calculated fantasy points from player_stats table
  const fetchWeeklyStats = async (week: number) => {
    if (!userTeam?.roster || !Array.isArray(userTeam.roster)) return;
    
    setLoading(true);
    try {
      const leagueCurrentWeek = providerCurrentWeek ?? league.current_week ?? getCurrentNFLWeek().week;
      const isHistorical = week < leagueCurrentWeek;
      
      // For Sleeper, fetch actuals for past weeks, use projections for current/future
      if (league.platform === 'sleeper') {
        const starterPlayers: any[] = [];
        const benchPlayers: any[] = [];
        
        // For historical weeks, fetch from player_stats
        if (isHistorical) {
          const now = new Date();
          const inferredSeason = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
          
          // Fetch actual stats from player_stats table
          const { data: statsData, error } = await supabase
            .from('player_stats')
            .select('*')
            .eq('week', week)
            .eq('season', inferredSeason)
            .eq('source_type', 'actual');
          
          if (error) {
            console.error('Error fetching player stats:', error);
          }
          
          // Create a map by normalized player name for matching
          const statsByName = new Map<string, any>();
          if (statsData) {
            for (const stat of statsData) {
              const normalizedName = stat.player_name.toLowerCase().replace(/[^a-z]/g, '');
              statsByName.set(normalizedName, stat);
            }
          }
          
          // Get league scoring settings
          const { data: leagueData } = await supabase
            .from('connected_leagues')
            .select('scoring_settings, scoring_type')
            .eq('id', league.id)
            .maybeSingle();
          
          // Default scoring for Sleeper (PPR)
          let scoringSettings: any = {
            passing_yards: 0.04,
            passing_tds: 4,
            interceptions: -2,
            rushing_yards: 0.1,
            rushing_tds: 6,
            receptions: 1,
            receiving_yards: 0.1,
            receiving_tds: 6,
            fumbles_lost: -2,
          };
          
          if (leagueData?.scoring_settings && typeof leagueData.scoring_settings === 'object') {
            scoringSettings = { ...scoringSettings, ...(leagueData.scoring_settings as Record<string, any>) };
          } else if (leagueData?.scoring_type === 'standard') {
            scoringSettings.receptions = 0;
          } else if (leagueData?.scoring_type === 'half_ppr') {
            scoringSettings.receptions = 0.5;
          }
          
          // Calculate fantasy points for each player
          userTeam.roster.forEach((player: any) => {
            const playerId = String(player.player_id ?? '');
            const playerName = player.player_name || 'Unknown Player';
            const positionName = player.position || 'FLEX';
            const isStarter = player.starter !== false;
            
            // Match by name
            const normalizedName = playerName.toLowerCase().replace(/[^a-z]/g, '');
            const stats = statsByName.get(normalizedName);
            
            let actualPoints = 0;
            if (stats) {
              // Calculate fantasy points based on stats
              actualPoints += (stats.passing_yards || 0) * (scoringSettings.passing_yards || 0);
              actualPoints += (stats.passing_tds || 0) * (scoringSettings.passing_tds || 0);
              actualPoints += (stats.interceptions || 0) * (scoringSettings.interceptions || 0);
              actualPoints += (stats.rushing_yards || 0) * (scoringSettings.rushing_yards || 0);
              actualPoints += (stats.rushing_tds || 0) * (scoringSettings.rushing_tds || 0);
              actualPoints += (stats.receptions || 0) * (scoringSettings.receptions || 0);
              actualPoints += (stats.receiving_yards || 0) * (scoringSettings.receiving_yards || 0);
              actualPoints += (stats.receiving_tds || 0) * (scoringSettings.receiving_tds || 0);
              actualPoints += (stats.fumbles_lost || 0) * (scoringSettings.fumbles_lost || 0);
              actualPoints += (stats.passing_2pt_conversions || 0) * (scoringSettings.passing_2pt_conversions || 2);
              actualPoints += (stats.rushing_2pt_conversions || 0) * (scoringSettings.rushing_2pt_conversions || 2);
              actualPoints += (stats.receiving_2pt_conversions || 0) * (scoringSettings.receiving_2pt_conversions || 2);
            }
            
            const playerTeam = stats?.team || player.team || 'NFL';
            const injuryStatus = player.injury_status ?? null;
            const isByeWeek = isTeamOnBye(playerTeam, week);
            
            const playerDataObj = {
              id: playerId || playerName,
              name: playerName,
              position: positionName,
              team: playerTeam,
              projected: 0,
              actualPoints: Math.round(actualPoints * 100) / 100,
              status: isStarter ? 'starter' : 'bench',
              is_bye_week: isByeWeek,
              injury_status: injuryStatus,
              week: week,
            };
            
            if (isStarter) {
              starterPlayers.push(playerDataObj);
            } else {
              benchPlayers.push(playerDataObj);
            }
          });
        } else {
          // For current/future weeks, fetch projections from projected_player_stats
          const now = new Date();
          const inferredSeason = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
          
          // Fetch projected stats for this specific week
          const { data: projectedStats, error: projError } = await supabase
            .from('projected_player_stats')
            .select('*')
            .eq('week', week)
            .eq('season', inferredSeason);
          
          if (projError) {
            console.error('Error fetching projected stats:', projError);
          }
          
          // Create a map by player_id and normalized name for matching
          const projByPlayerId = new Map<string, any>();
          const projByName = new Map<string, any>();
          if (projectedStats) {
            for (const proj of projectedStats) {
              if (proj.player_id) {
                projByPlayerId.set(proj.player_id, proj);
              }
              const normalizedName = proj.player_name.toLowerCase().replace(/[^a-z]/g, '');
              projByName.set(normalizedName, proj);
            }
          }
          
          userTeam.roster.forEach((player: any) => {
            const playerId = String(player.player_id ?? '');
            const playerName = player.player_name || 'Unknown Player';
            const positionName = player.position || 'FLEX';
            const isStarter = player.starter !== false;
            
            // Try to find projection by ID first, then by name
            const normalizedName = playerName.toLowerCase().replace(/[^a-z]/g, '');
            const projection = projByPlayerId.get(playerId) || projByName.get(normalizedName);
            
            const projectedPoints = projection?.projected_fp || player.projected || 0;
            const playerTeam = projection?.team || player.team || 'NFL';
            const injuryStatus = player.injury_status ?? null;
            const isByeWeek = isTeamOnBye(playerTeam, week);
            
            const playerDataObj = {
              id: playerId || playerName,
              name: playerName,
              position: positionName,
              team: playerTeam,
              projected: projectedPoints,
              actualPoints: 0,
              status: isStarter ? 'starter' : 'bench',
              is_bye_week: isByeWeek,
              injury_status: injuryStatus,
              week: week,
            };
            
            if (isStarter) {
              starterPlayers.push(playerDataObj);
            } else {
              benchPlayers.push(playerDataObj);
            }
          });
        }
        
        setStarters(starterPlayers);
        setBench(benchPlayers);
        setLoading(false);
        return;
      }
      
      // For ESPN and other platforms, fetch from get-player-data
      const playerIds = userTeam.roster
        .map((p: any) => String(p.player_id || p.playerId || p.id || ''))
        .filter(Boolean);

      const now = new Date();
      const inferredSeason = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;

      const { data: playerData, error } = await supabase.functions.invoke('get-player-data', {
        body: { 
          week: Number(week), 
          season: inferredSeason,
          leagueId: league.id,
          playerIds 
        }
      });

      if (error) throw error;

      if (!playerData?.players) {
        console.error('No player data returned');
        return;
      }

      // Create lookup maps separated by source type
      const projById = new Map(
        playerData.players.filter((p: any) => p.source_type === 'projected').map((p: any) => [String(p.player_id), p])
      );
      const actualById = new Map(
        playerData.players.filter((p: any) => p.source_type !== 'projected').map((p: any) => [String(p.player_id), p])
      );
      const projByName = new Map(
        playerData.players.filter((p: any) => p.source_type === 'projected').map((p: any) => [p.player_name?.toLowerCase().trim(), p])
      );
      const actualByName = new Map(
        playerData.players.filter((p: any) => p.source_type !== 'projected').map((p: any) => [p.player_name?.toLowerCase().trim(), p])
      );

      const starterPlayers: any[] = [];
      const benchPlayers: any[] = [];
      const currentWeek = league.current_week || getCurrentNFLWeek().week;

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

        // Determine week context
        const isHistorical = week < currentWeek;

        // Resolve stats preferring actuals for past weeks and projections for current week
        const actualStats = (actualById.get(playerId) as any) || (playerName ? actualByName.get(playerName.toLowerCase().trim()) as any : undefined);
        const projStats = (projById.get(playerId) as any) || (playerName ? projByName.get(playerName.toLowerCase().trim()) as any : undefined);
        const chosenStats = isHistorical ? (actualStats || projStats) : (projStats || actualStats);
        
        const projectedPoints = !isHistorical
          ? (positionName === 'K' || positionName === 'DST'
              ? (projStats?.projected_fp ?? projStats?.fantasy_points ?? actualStats?.fantasy_points ?? 0)
              : (projStats?.fantasy_points ?? actualStats?.fantasy_points ?? 0))
          : 0;
        
        const actualPoints = isHistorical ? ((actualStats?.fantasy_points ?? projStats?.fantasy_points ?? 0)) : 0;
        const playerTeam = chosenStats?.team || player.team || 'NFL';
        const injuryStatus = player.injury_status ?? null;
        const isByeWeek = isTeamOnBye(playerTeam, week);
        
        const playerDataObj = {
          id: playerId || playerName,
          name: playerName,
          position: positionName,
          team: playerTeam,
          projected: projectedPoints,
          actualPoints: actualPoints,
          status: isStarter ? 'starter' : 'bench',
          is_bye_week: isByeWeek,
          injury_status: injuryStatus,
          week: week,
        };

        if (isStarter) {
          starterPlayers.push(playerDataObj);
        } else if (isBench) {
          benchPlayers.push(playerDataObj);
        }
      });

      setStarters(starterPlayers);
      setBench(benchPlayers);
    } catch (err) {
      console.error('Error fetching player stats:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (league.platform === 'sleeper') {
      fetch('https://api.sleeper.app/v1/state/nfl')
        .then(res => res.json())
        .then(state => {
          if (state?.week) setProviderCurrentWeek(Number(state.week));
        })
        .catch(() => {});
    } else {
      setProviderCurrentWeek(null);
    }
  }, [league.platform]);

  // Reset the one-time auto-set guard when switching leagues
  useEffect(() => {
    hasAutoSetSelectedWeek.current = false;
  }, [league.id]);

  // For Sleeper: once provider week is known, set it as initial selected week (one-time)
  useEffect(() => {
    if (
      league.platform === 'sleeper' &&
      typeof providerCurrentWeek === 'number' &&
      providerCurrentWeek > 0 &&
      !hasAutoSetSelectedWeek.current
    ) {
      setSelectedWeek(providerCurrentWeek);
      hasAutoSetSelectedWeek.current = true;
    }
  }, [league.platform, providerCurrentWeek]);

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

  const handlePlayerClick = (player: any) => {
    setSelectedPlayer(player);
    setStatsDialogOpen(true);
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
  const currentWeek = providerCurrentWeek ?? league.current_week ?? getCurrentNFLWeek().week;
  const isHistoricalWeek = selectedWeek < currentWeek;
  const isFutureWeek = selectedWeek > currentWeek;
  const maxWeek = 18; // NFL regular season weeks

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
    <div className="spacing-mobile">
      {/* Week Navigation */}
      <Card>
        <CardContent className="py-3 sm:py-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleWeekChange('prev')}
              disabled={selectedWeek <= 1 || loading}
              className="touch-target"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Previous Week</span>
              <span className="sm:hidden">Prev</span>
            </Button>
            
            <div className="flex items-center justify-center gap-2 sm:gap-4">
              <div className="text-center">
                <p className="text-xs sm:text-sm text-muted-foreground">Viewing Week</p>
                <Select 
                  value={String(selectedWeek)} 
                  onValueChange={(v) => setSelectedWeek(Number(v))}
                  disabled={loading}
                >
                  <SelectTrigger className="w-20 sm:w-24 touch-target">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card z-50 max-h-[300px]">
                    {Array.from({ length: maxWeek }, (_, i) => i + 1).map(w => (
                      <SelectItem key={w} value={String(w)}>
                        Week {w}
                        {w === currentWeek && <span className="ml-1 text-xs text-primary">(Current)</span>}
                        {w > currentWeek && <span className="ml-1 text-xs text-muted-foreground">(Future)</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {isHistoricalWeek && (
                <div className="text-xs sm:text-sm px-2 sm:px-3 py-1 bg-secondary rounded-md">
                  <span className="hidden sm:inline">Historical Data</span>
                  <span className="sm:hidden">Historical</span>
                </div>
              )}
              
              {isFutureWeek && (
                <div className="text-xs sm:text-sm px-2 sm:px-3 py-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-md">
                  <span className="hidden sm:inline">Projected</span>
                  <span className="sm:hidden">Proj</span>
                </div>
              )}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => handleWeekChange('next')}
              disabled={selectedWeek >= maxWeek || loading}
              className="touch-target"
            >
              <span className="hidden sm:inline">Next Week</span>
              <span className="sm:hidden">Next</span>
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
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <CardTitle className="text-lg sm:text-xl">Starting Lineup</CardTitle>
            <div className="text-left sm:text-right">
              {isHistoricalWeek ? (
                <>
                  <p className="text-xs sm:text-sm text-muted-foreground">Actual Points Scored</p>
                  <p className="text-xl sm:text-2xl font-bold text-primary">{totalActual.toFixed(1)}</p>
                </>
              ) : (
                <>
                  <p className="text-xs sm:text-sm text-muted-foreground">Total Projected</p>
                  <p className="text-xl sm:text-2xl font-bold text-primary">{totalProjected.toFixed(1)}</p>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
              {starters.map(player => (
                <div key={player.id} onClick={() => handlePlayerClick(player)} className="cursor-pointer">
                  <PlayerCard
                    player={player}
                    isSelected={selectedPlayers.includes(player.id)}
                    onSelect={handlePlayerSelect}
                    showActual={isHistoricalWeek}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg sm:text-xl">Bench</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-8 text-muted-foreground">Loading...</p>
          ) : bench.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No bench players found</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
              {bench.map(player => (
                <div key={player.id} onClick={() => handlePlayerClick(player)} className="cursor-pointer">
                  <PlayerCard
                    player={player}
                    isSelected={selectedPlayers.includes(player.id)}
                    onSelect={handlePlayerSelect}
                    showActual={isHistoricalWeek}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <PlayerStatsDialog
        player={selectedPlayer}
        open={statsDialogOpen}
        onOpenChange={setStatsDialogOpen}
        week={selectedWeek}
        leagueId={league.id}
      />
    </div>
  );
}
