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

      // Fetch user's team for this league using the user_team_id from league data
      if (leagueData.user_team_id) {
        const { data: teamData, error: teamError } = await supabase
          .from('user_teams')
          .select('*')
          .eq('league_id', leagueId)
          .eq('team_id', leagueData.user_team_id)
          .maybeSingle();

        if (teamError) throw teamError;
        setUserTeam(teamData);
      } else {
        setUserTeam(null);
      }

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
          <TabsList className="grid w-full grid-cols-4 max-w-2xl mx-auto">
            <TabsTrigger value="roster">My Team</TabsTrigger>
            <TabsTrigger value="matchup">Matchup</TabsTrigger>
            <TabsTrigger value="waiver">Waiver Wire</TabsTrigger>
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

          <TabsContent value="waiver" className="mt-6">
            <WaiverWire 
              league={league}
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
