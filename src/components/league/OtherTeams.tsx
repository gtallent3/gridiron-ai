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

// Mock teams data
const mockTeams: LeagueTeam[] = [
  { id: '1', team_id: 't1', team_name: 'The Gronk Squad', roster: {} },
  { id: '2', team_id: 't2', team_name: 'Mahomes Alone', roster: {} },
  { id: '3', team_id: 't3', team_name: 'Taylor Made Winners', roster: {} },
  { id: '4', team_id: 't4', team_name: 'Third Down Conversions', roster: {} },
  { id: '5', team_id: 't5', team_name: 'Fantasy Footballers', roster: {} },
];

const mockRoster = [
  { id: 'p1', name: 'Josh Allen', position: 'QB', team: 'BUF', projected: 26.3 },
  { id: 'p2', name: 'Derrick Henry', position: 'RB', team: 'BAL', projected: 19.5 },
  { id: 'p3', name: 'De\'Von Achane', position: 'RB', team: 'MIA', projected: 17.2 },
  { id: 'p4', name: 'Amon-Ra St. Brown', position: 'WR', team: 'DET', projected: 17.8 },
  { id: 'p5', name: 'A.J. Brown', position: 'WR', team: 'PHI', projected: 16.5 },
  { id: 'p6', name: 'Trey McBride', position: 'TE', team: 'ARI', projected: 12.8 },
  { id: 'p7', name: 'Justin Tucker', position: 'K', team: 'BAL', projected: 9.2 },
  { id: 'p8', name: 'BAL Defense', position: 'DEF', team: 'BAL', projected: 10.5 },
];

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
      
      // Use real data if available, otherwise use mock
      setTeams(data && data.length > 0 ? data : mockTeams);
    } catch (error) {
      console.error('Error fetching teams:', error);
      setTeams(mockTeams);
    } finally {
      setIsLoading(false);
    }
  };

  const viewTeamDetails = (team: LeagueTeam) => {
    setSelectedTeam(team);
  };

  const filteredTeams = teams.filter(team => team.team_id !== currentTeamId);

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
            League Teams
          </CardTitle>
        </CardHeader>
        <CardContent>
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
                      <Badge variant="outline">4-3</Badge>
                      <span>•</span>
                      <span>115.2 pts/game</span>
                    </div>
                    <Button variant="outline" className="w-full" size="sm">
                      View Roster
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!selectedTeam} onOpenChange={() => setSelectedTeam(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">{selectedTeam?.team_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="flex gap-4 text-sm">
              <Badge>Record: 4-3</Badge>
              <Badge variant="outline">Total Points: 806.4</Badge>
              <Badge variant="outline">Avg: 115.2 pts/game</Badge>
            </div>
            
            <div>
              <h4 className="font-semibold mb-3">Starting Lineup</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {mockRoster.map(player => (
                  <PlayerCard
                    key={player.id}
                    player={player}
                    readOnly
                  />
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
