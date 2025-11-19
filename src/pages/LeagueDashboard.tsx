import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, Trophy } from "lucide-react";
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
import { PositionalRankings } from "@/components/league/PositionalRankings";
import { ImprovePosition } from "@/components/league/ImprovePosition";
import { ComputeValuesCard } from "@/components/league/ComputeValuesCard";

type League = {
  id: string;
  platform: string;
  league_name: string;
  league_size: number;
  scoring_type: string;
  league_id: string;
  current_week: number;
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
        
        // Fetch accurate data from ESPN for current week (only for ESPN leagues)
        const currentWeek = leagueData.current_week || 7;
        
        if (leagueData.platform !== 'espn') {
          // Skip ESPN-specific enrichment for non-ESPN leagues (e.g., Sleeper)
          return rosterArray;
        }
        
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
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <Trophy className="h-12 w-12 text-primary animate-bounce" />
            <div className="absolute inset-0 animate-ping opacity-20">
              <Trophy className="h-12 w-12 text-primary" />
            </div>
          </div>
          <p className="text-sm text-muted-foreground animate-pulse">Loading your league...</p>
        </div>
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
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20 mt-16">
      <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-6">
        <Button
          variant="ghost"
          onClick={() => navigate('/')}
          className="mb-4 sm:mb-6 touch-target"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          <span className="hidden sm:inline">Back to Leagues</span>
          <span className="sm:hidden">Back</span>
        </Button>

        <LeagueHeader 
          league={league} 
          userTeam={userTeam}
          onSyncComplete={fetchLeagueData}
        />

        <Tabs defaultValue="roster" className="mt-4 sm:mt-8">
          <TabsList className="grid w-full grid-cols-3 sm:grid-cols-6 max-w-4xl mx-auto h-auto">
            <TabsTrigger value="roster" className="text-xs sm:text-sm py-2">
              <span className="hidden sm:inline">My Team</span>
              <span className="sm:hidden">Team</span>
            </TabsTrigger>
            <TabsTrigger value="matchup" className="text-xs sm:text-sm py-2">
              <span className="hidden sm:inline">Matchup</span>
              <span className="sm:hidden">Match</span>
            </TabsTrigger>
            <TabsTrigger value="trade" className="text-xs sm:text-sm py-2">
              <span className="hidden sm:inline">Trade Analyzer</span>
              <span className="sm:hidden">Trade</span>
            </TabsTrigger>
            <TabsTrigger value="waiver" className="text-xs sm:text-sm py-2">
              <span className="hidden sm:inline">Waiver Wire</span>
              <span className="sm:hidden">Waiver</span>
            </TabsTrigger>
            <TabsTrigger value="ai" className="text-xs sm:text-sm py-2">
              <span className="hidden sm:inline">AI Assistant</span>
              <span className="sm:hidden">AI</span>
            </TabsTrigger>
            <TabsTrigger value="teams" className="text-xs sm:text-sm py-2">
              <span className="hidden sm:inline">Other Teams</span>
              <span className="sm:hidden">Teams</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="roster" className="mt-4 sm:mt-6">
            <RosterView 
              league={league} 
              userTeam={userTeam}
            />
          </TabsContent>

          <TabsContent value="matchup" className="mt-4 sm:mt-6">
            <MatchupInsight 
              league={league}
              userTeam={userTeam}
            />
          </TabsContent>

          <TabsContent value="trade" className="mt-4 sm:mt-6">
            {!userTeam ? (
              <div className="text-center py-12 space-y-4">
                <p className="text-muted-foreground">
                  Unable to load your team data. Please try resyncing your league.
                </p>
                <Button onClick={() => navigate('/')}>
                  Back to Leagues
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <ComputeValuesCard leagueId={league.id} />
                
                <Tabs defaultValue="analyzer" className="spacing-mobile">
                  <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 max-w-4xl mx-auto h-auto">
                    <TabsTrigger value="analyzer" className="text-xs sm:text-sm py-2 sm:py-3">
                      <span className="hidden sm:inline">Trade Analyzer</span>
                      <span className="sm:hidden">Analyzer</span>
                    </TabsTrigger>
                    <TabsTrigger value="finder" className="text-xs sm:text-sm py-2 sm:py-3">
                      <span className="hidden sm:inline">Find Trades</span>
                      <span className="sm:hidden">Find</span>
                    </TabsTrigger>
                    <TabsTrigger value="improve" className="text-xs sm:text-sm py-2 sm:py-3">
                      <span className="hidden sm:inline">Improve</span>
                      <span className="sm:hidden">Improve</span>
                    </TabsTrigger>
                    <TabsTrigger value="rankings" className="text-xs sm:text-sm py-2 sm:py-3">
                      <span className="hidden sm:inline">Rankings</span>
                      <span className="sm:hidden">Ranks</span>
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="analyzer">
                    <TradeAnalyzer league={league} userTeam={userTeam} />
                  </TabsContent>

                  <TabsContent value="finder">
                    <TradeFinder league={league} userTeam={userTeam} allTeams={allTeams} />
                  </TabsContent>

                  <TabsContent value="improve">
                    <ImprovePosition 
                      leagueId={league.id}
                      myTeamId={userTeam.team_id}
                      myTeam={userTeam}
                      allTeams={allTeams}
                    />
                  </TabsContent>

                  <TabsContent value="rankings">
                    <PositionalRankings leagueId={league.id} teams={allTeams} />
                  </TabsContent>
                </Tabs>
              </div>
            )}
          </TabsContent>

          <TabsContent value="waiver" className="mt-4 sm:mt-6">
            <WaiverWire 
              league={league}
              userTeam={userTeam}
              allTeams={allTeams}
            />
          </TabsContent>

          <TabsContent value="ai" className="mt-4 sm:mt-6">
            <LeagueAIAssistant 
              league={league}
              userTeam={userTeam}
            />
          </TabsContent>

          <TabsContent value="teams" className="mt-4 sm:mt-6">
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
