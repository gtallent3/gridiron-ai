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
      
      setTeams(data || []);
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
