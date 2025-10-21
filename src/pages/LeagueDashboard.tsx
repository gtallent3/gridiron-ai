import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RosterView } from "@/components/league/RosterView";
import { MatchupInsight } from "@/components/league/MatchupInsight";
import { WaiverWire } from "@/components/league/WaiverWire";
import { OtherTeams } from "@/components/league/OtherTeams";
import { LeagueHeader } from "@/components/league/LeagueHeader";
import { TradeAnalyzer } from "@/components/league/trade/TradeAnalyzer";
import { TradeFinder } from "@/components/league/trade/TradeFinder";
import { PositionImprover } from "@/components/league/trade/PositionImprover";
import { LeagueAIAssistant } from "@/components/league/LeagueAIAssistant";

type League = {
  id: string;
  platform: string;
  league_name: string;
  league_size: number;
  scoring_type: string;
  league_id: string;
};

type Team = {
  id: string;
  team_id: string;
  team_name: string;
  roster: any;
};

export default function LeagueDashboard() {
  const { leagueId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [league, setLeague] = useState<League | null>(null);
  const [userTeam, setUserTeam] = useState<Team | null>(null);
  const [allTeams, setAllTeams] = useState<Team[]>([]);

  useEffect(() => {
    const checkAuthAndFetchData = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate('/auth');
        return;
      }
      await fetchLeagueData();
    };

    checkAuthAndFetchData();
  }, [leagueId, navigate]);

  const fetchLeagueData = async () => {
    try {
      setLoading(true);

      // Fetch league details
      const { data: leagueData, error: leagueError } = await supabase
        .from('connected_leagues')
        .select('*')
        .eq('id', leagueId)
        .single();

      if (leagueError) throw leagueError;
      setLeague(leagueData);

      // Helper function to enrich roster with ESPN data
      const enrichRosterWithValuations = async (roster: any) => {
        // Ensure roster is an array
        const rosterArray = Array.isArray(roster) ? roster : [];
        
        if (rosterArray.length === 0) return rosterArray;
        
        // Fetch accurate data from ESPN for current week
        const currentWeek = leagueData.current_week || 7;
        
        try {
          const { data: weekScores, error } = await supabase.functions.invoke('get-espn-week-scores', {
            body: { week: currentWeek, leagueId: leagueId }
          });

          if (error) throw error;

          if (!weekScores?.players) {
            console.error('No player data returned from ESPN');
            return rosterArray;
          }

          // Create maps for quick lookup by player ID and name
          const scoresMapById = new Map(
            weekScores.players.map((p: any) => [String(p.player_id), p])
          );
          const scoresMapByName = new Map(
            weekScores.players.map((p: any) => [p.player_name?.toLowerCase().trim(), p])
          );
          
          // Enrich roster with ESPN data by matching player ID or name
          return rosterArray.map((player: any) => {
            const playerId = String(player.player_id || player.playerId || player.id || '');
            const playerName = player.player_name?.toLowerCase().trim();
            
            // Try ID match first, then name match
            let espnData = scoresMapById.get(playerId) as any;
            if (!espnData && playerName) {
              espnData = scoresMapByName.get(playerName) as any;
            }
            
            return {
              ...player,
              is_bye_week: espnData?.is_bye_week || false,
              injury_status: espnData?.injury_status || null,
              injury_duration_weeks: espnData?.injury_duration_weeks || 0,
            };
          });
        } catch (err) {
          console.error('Error enriching roster with ESPN data:', err);
          return rosterArray;
        }
      };

      // Fetch user's team for this league using the user_team_id from league data
      if (leagueData.user_team_id) {
        const { data: teamData, error: teamError } = await supabase
          .from('user_teams')
          .select('*')
          .eq('league_id', leagueId)
          .eq('team_id', leagueData.user_team_id)
          .maybeSingle();

        if (teamError) throw teamError;
        
        // Enrich roster with player valuations
        if (teamData && teamData.roster) {
          teamData.roster = await enrichRosterWithValuations(teamData.roster);
        }
        
        setUserTeam(teamData);
      } else {
        setUserTeam(null);
      }

      // Fetch all teams in the league
      const { data: allTeamsData, error: teamsError } = await supabase
        .from('user_teams')
        .select('*')
        .eq('league_id', leagueId);

      if (teamsError) throw teamsError;
      
      // Enrich all teams' rosters with player valuations
      if (allTeamsData) {
        for (const team of allTeamsData) {
          if (team.roster) {
            team.roster = await enrichRosterWithValuations(team.roster);
          }
        }
      }
      
      setAllTeams(allTeamsData || []);

    } catch (error: any) {
      console.error('Error fetching league data:', error);
      toast({
        title: "Error",
        description: "Failed to load league data",
        variant: "destructive",
      });
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!league) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">League not found</p>
          <Button onClick={() => navigate('/')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      <div className="container mx-auto px-4 py-6">
        <Button
          variant="ghost"
          onClick={() => navigate('/')}
          className="mb-6"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Leagues
        </Button>

        <LeagueHeader 
          league={league} 
          userTeam={userTeam}
        />

        <Tabs defaultValue="roster" className="mt-8">
          <TabsList className="grid w-full grid-cols-6 max-w-4xl mx-auto">
            <TabsTrigger value="roster">My Team</TabsTrigger>
            <TabsTrigger value="matchup">Matchup</TabsTrigger>
            <TabsTrigger value="trade">Trade Analyzer</TabsTrigger>
            <TabsTrigger value="waiver">Waiver Wire</TabsTrigger>
            <TabsTrigger value="ai">AI Assistant</TabsTrigger>
            <TabsTrigger value="teams">Other Teams</TabsTrigger>
          </TabsList>

          <TabsContent value="roster" className="mt-6">
            <RosterView 
              league={league} 
              userTeam={userTeam}
            />
          </TabsContent>

          <TabsContent value="matchup" className="mt-6">
            <MatchupInsight 
              league={league}
              userTeam={userTeam}
            />
          </TabsContent>

          <TabsContent value="trade" className="mt-6">
            <Tabs defaultValue="analyzer" className="space-y-6">
              <TabsList className="grid w-full grid-cols-3 max-w-2xl mx-auto">
                <TabsTrigger value="analyzer">Grade Trade</TabsTrigger>
                <TabsTrigger value="finder">Find Trades</TabsTrigger>
                <TabsTrigger value="improve">Improve Position</TabsTrigger>
              </TabsList>

              <TabsContent value="analyzer">
                <TradeAnalyzer league={league} userTeam={userTeam} />
              </TabsContent>

              <TabsContent value="finder">
                <TradeFinder league={league} userTeam={userTeam!} allTeams={allTeams} />
              </TabsContent>

              <TabsContent value="improve">
                <PositionImprover league={league} userTeam={userTeam!} allTeams={allTeams} />
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="waiver" className="mt-6">
            <WaiverWire 
              league={league}
            />
          </TabsContent>

          <TabsContent value="ai" className="mt-6">
            <LeagueAIAssistant 
              league={league}
              userTeam={userTeam}
            />
          </TabsContent>

          <TabsContent value="teams" className="mt-6">
            <OtherTeams 
              league={league}
              currentTeamId={userTeam?.team_id}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
