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
      
      // Enrich teams with weekly stats
      const currentWeek = league.current_week || getCurrentNFLWeek().week;
      const now = new Date();
      const inferredSeason = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
      const isHistorical = currentWeek < (league.current_week || getCurrentNFLWeek().week);

      // Fetch stats for the current week
      let statsData: any[] = [];
      if (isHistorical) {
        const { data: actuals } = await supabase
          .from('nfl_fantasy_points')
          .select('*')
          .eq('week', currentWeek)
          .eq('season', inferredSeason);
        statsData = actuals || [];
      } else {
        const { data: projections } = await supabase
          .from('projected_player_stats')
          .select('*')
          .eq('week', currentWeek)
          .eq('season', inferredSeason);
        statsData = projections || [];
      }

      // Create map by normalized name
      const statsByName = new Map<string, any>();
      for (const stat of statsData) {
        const normalizedName = stat.player_name.toLowerCase().replace(/[^a-z]/g, '');
        statsByName.set(normalizedName, stat);
      }

      // Get scoring settings
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
          const playerName = player.player_name || 'Unknown Player';
          const normalizedName = playerName.toLowerCase().replace(/[^a-z]/g, '');
          const stats = statsByName.get(normalizedName);

          let points = 0;
          if (isHistorical && stats) {
            // Calculate actual points
            points += (stats.passing_yards || 0) * scoringSettings.passing_yards;
            points += (stats.passing_tds || 0) * scoringSettings.passing_tds;
            points += (stats.interceptions || 0) * scoringSettings.interceptions;
            points += (stats.rushing_yards || 0) * scoringSettings.rushing_yards;
            points += (stats.rushing_tds || 0) * scoringSettings.rushing_tds;
            points += (stats.receptions || 0) * scoringSettings.receptions;
            points += (stats.receiving_yards || 0) * scoringSettings.receiving_yards;
            points += (stats.receiving_tds || 0) * scoringSettings.receiving_tds;
            points += (stats.fumbles_lost || 0) * scoringSettings.fumbles_lost;
          } else if (!isHistorical && stats) {
            // Use projected points
            points = stats.projected_fp || 0;
          }

          const playerTeam = stats?.team || player.team || 'NFL';
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
