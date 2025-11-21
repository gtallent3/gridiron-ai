import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlayerCard } from "./PlayerCard";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isTeamOnBye } from "@/lib/byeWeekSchedule";
import { getCurrentNFLWeek } from "@/lib/nflWeekUtils";
import { calculateFantasyPoints } from "@/lib/fantasyPointsCalculator";

// ESPN numeric position -> label mapping
const POSITION_MAP: Record<number, string> = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  16: 'DEF',
};

type League = {
  id: string;
  platform: string;
  current_week: number;
};

type OtherTeamsProps = {
  league: League;
  currentTeamId?: string;
};

type LeagueTeam = {
  id: string;
  team_id: string;
  team_name: string;
  roster: any;
};

export function OtherTeams({ league, currentTeamId }: OtherTeamsProps) {
  const [teams, setTeams] = useState<LeagueTeam[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<LeagueTeam | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchTeams();
  }, [league.id]);

  const fetchTeams = async () => {
    try {
      setIsLoading(true);
      
      const { data, error } = await supabase
        .from('user_teams')
        .select('*')
        .eq('league_id', league.id);

      if (error) throw error;
      
      // Enrich teams with weekly stats from player_pool_v2
      const currentWeek = league.current_week || getCurrentNFLWeek().week;
      const now = new Date();
      const inferredSeason = now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear();
      const isHistorical = currentWeek < (league.current_week || getCurrentNFLWeek().week);

      // Get platform ID field
      const platformIdField = league.platform === 'espn' ? 'espn_id' : 'yahoo_id';
      
      // Collect all player IDs from all teams
      const allPlayerIds = new Set<string>();
      for (const team of data || []) {
        const roster = Array.isArray(team.roster) ? team.roster : [];
        for (const player of roster) {
          const playerObj = player as any;
          const playerId = String(playerObj.player_id ?? playerObj.playerId ?? playerObj.id ?? '');
          if (playerId) allPlayerIds.add(playerId);
        }
      }

      // Look up canonical players
      const { data: canonicalData } = await supabase
        .from('canonical_players')
        .select('id, player_name, position, team, espn_id, yahoo_id')
        .in(platformIdField, Array.from(allPlayerIds));

      const canonicalMap = new Map<string, any>();
      if (canonicalData) {
        for (const cp of canonicalData) {
          const platformId = league.platform === 'espn' ? cp.espn_id : cp.yahoo_id;
          if (platformId) {
            canonicalMap.set(String(platformId), cp);
          }
        }
      }

      const canonicalIds = Array.from(canonicalMap.values()).map(cp => cp.id);

      // Fetch from player_pool_v2 - prioritize actual stats
      const { data: poolData } = await supabase
        .from('player_pool_v2')
        .select('*')
        .eq('week', currentWeek)
        .eq('season', inferredSeason)
        .in('canonical_player_id', canonicalIds)
        .order('actual_fp', { ascending: false, nullsFirst: false });

      const poolMap = new Map<string, any>();
      if (poolData) {
        for (const pool of poolData) {
          const existing = poolMap.get(pool.canonical_player_id);
          if (!existing || (Number(pool.actual_fp) > 0 && Number(existing.actual_fp) === 0)) {
            poolMap.set(pool.canonical_player_id, pool);
          }
        }
      }

      // Get league scoring settings
      const { data: leagueData } = await supabase
        .from('connected_leagues')
        .select('scoring_settings, scoring_type')
        .eq('id', league.id)
        .maybeSingle();

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

      const enrichedTeams = (data || []).map((team: any) => {
        const roster = Array.isArray(team.roster) ? team.roster : [];
        const enrichedRoster = roster.map((player: any) => {
          const playerId = String(player.player_id ?? player.playerId ?? player.id ?? '');
          const canonical = canonicalMap.get(playerId);
          const poolEntry = canonical ? poolMap.get(canonical.id) : null;

          let points = 0;
          if (poolEntry) {
            const stats = {
              passing_yards: Number(poolEntry.passing_yards) || 0,
              passing_tds: Number(poolEntry.passing_tds) || 0,
              interceptions: Number(poolEntry.passing_ints) || 0,
              rushing_yards: Number(poolEntry.rushing_yards) || 0,
              rushing_tds: Number(poolEntry.rushing_tds) || 0,
              receptions: Number(poolEntry.receptions) || 0,
              receiving_yards: Number(poolEntry.receiving_yards) || 0,
              receiving_tds: Number(poolEntry.receiving_tds) || 0,
            };

            const { total } = calculateFantasyPoints(stats, scoringSettings);
            
            if (isHistorical) {
              points = total || Number(poolEntry.actual_fp) || Number(poolEntry.composite_fp) || 0;
            } else {
              // For current week, check if player has already played
              const hasActualStats = Number(poolEntry.actual_fp) > 0;
              points = total || Number(poolEntry.projected_fp) || Number(poolEntry.composite_fp) || 0;
            }
          }

          const playerTeam = poolEntry?.team || canonical?.team || player.team || 'NFL';
          const isByeWeek = isTeamOnBye(playerTeam, currentWeek);

          return {
            ...player,
            projected: Math.round(points * 100) / 100,
            is_bye_week: isByeWeek,
          };
        });

        return { ...team, roster: enrichedRoster };
      });
      
      setTeams(enrichedTeams);
    } catch (error) {
      console.error('Error fetching teams:', error);
      setTeams([]);
    } finally {
      setIsLoading(false);
    }
  };

  const viewTeamDetails = (team: LeagueTeam) => {
    setSelectedTeam(team);
  };

  const filteredTeams = teams.filter(team => team.team_id !== currentTeamId);

  const getTeamRoster = (team: LeagueTeam) => {
    if (!team.roster || !Array.isArray(team.roster)) return [];

    return team.roster.map((player: any) => {
      const rawPos = player.position;
      const position = typeof rawPos === 'number' ? (POSITION_MAP[rawPos] || 'FLEX') : (rawPos || 'FLEX');
      return {
        id: player.player_id || player.playerId,
        name: player.player_name || player.playerName || 'Unknown',
        position,
        team: player.team || 'NFL',
        projected: typeof player.projected === 'number' ? player.projected : 0,
        is_bye_week: player.is_bye_week || false,
        injury_status: player.injury_status || null,
        injury_duration_weeks: player.injury_duration_weeks || 0,
      };
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            League Teams ({filteredTeams.length} {filteredTeams.length === 1 ? 'team' : 'teams'})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredTeams.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              No other teams found in this league
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTeams.map((team) => (
              <Card 
                key={team.id}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => viewTeamDetails(team)}
              >
                <CardContent className="p-6">
                  <div className="space-y-3">
                    <h3 className="font-semibold text-lg">{team.team_name}</h3>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>{team.roster?.length || 0} players</span>
                    </div>
                    <Button variant="outline" className="w-full" size="sm">
                      View Roster
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedTeam} onOpenChange={() => setSelectedTeam(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">{selectedTeam?.team_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="flex gap-4 text-sm">
              <Badge>{selectedTeam?.roster?.length || 0} players</Badge>
            </div>
            
            <div>
              <h4 className="font-semibold mb-3">Roster</h4>
              {selectedTeam && getTeamRoster(selectedTeam).length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {getTeamRoster(selectedTeam).map(player => (
                    <PlayerCard
                      key={player.id}
                      player={player}
                      readOnly
                    />
                  ))}
                </div>
              ) : (
                <p className="text-center py-8 text-muted-foreground">No roster data available</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
