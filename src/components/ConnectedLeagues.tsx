import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Loader2, Plus, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";

type League = {
  id: string;
  platform: string;
  league_name: string;
  league_size: number;
  scoring_type: string;
  scoring_settings?: any;
  last_synced_at: string;
};

export const ConnectedLeagues = () => {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  const getDisplayScoringType = (lg: any) => {
    const defaultType = lg.scoring_type;
    if (lg.platform !== 'espn' || !lg.scoring_settings) return defaultType;
    const items = lg.scoring_settings.scoringItems;
    if (!items) return defaultType;

    let recPoints: number | undefined;
    if (Array.isArray(items)) {
      const recItem = items.find((it: any) => it?.statId === 53);
      recPoints = recItem?.points ?? recItem?.value;
    } else if (typeof items === 'object') {
      const candidate = items['53'] ?? items[53];
      recPoints = candidate?.points ?? candidate?.value ?? candidate;
    }

    if (typeof recPoints !== 'number') return defaultType;
    if (recPoints === 1 || recPoints === 1.0) return 'ppr';
    if (recPoints === 0.5) return 'half_ppr';
    if (recPoints === 0) return 'standard';
    return 'custom';
  };

  useEffect(() => {
    fetchLeagues();
  }, []);

  const fetchLeagues = async () => {
    try {
      const { data, error } = await supabase
        .from('connected_leagues')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setLeagues(data || []);
    } catch (error: any) {
      console.error('Error fetching leagues:', error);
      toast({
        title: "Error",
        description: "Failed to load leagues",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickResync = async (e: React.MouseEvent, leagueId: string, platform: string) => {
    e.stopPropagation(); // Prevent navigation
    
    if (platform !== 'espn') {
      toast({
        title: "Not Available",
        description: "Quick resync is currently only available for ESPN leagues",
      });
      return;
    }

    setRefreshingId(leagueId);
    try {
      const { data, error } = await supabase.functions.invoke('resync-espn-league', {
        body: { leagueId }
      });

      if (error) {
        if (error.message?.includes('credentials') || error.message?.includes('expired')) {
          toast({
            title: "Credentials Expired",
            description: "Please reconnect your ESPN league",
            variant: "destructive",
          });
          return;
        }
        throw error;
      }

      await fetchLeagues();
      toast({
        title: "✅ Resynced",
        description: "League data updated successfully",
      });
    } catch (error: any) {
      console.error('Error resyncing:', error);
      toast({
        title: "Resync Failed",
        description: "Please try again or reconnect your league",
        variant: "destructive",
      });
    } finally {
      setRefreshingId(null);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (leagues.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No Leagues Connected</CardTitle>
          <CardDescription>Connect your fantasy leagues to get started</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => navigate('/connect-league')} variant="glow" className="w-full">
            <Plus className="mr-2 h-4 w-4" />
            Connect Your First League
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Connected Leagues</CardTitle>
            <CardDescription>Your synced fantasy football leagues</CardDescription>
          </div>
          <Button onClick={() => navigate('/connect-league')} variant="outline" size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Add League
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {leagues.map((league) => (
          <div
            key={league.id}
            className="flex items-center justify-between p-4 rounded-lg border border-border/50 hover:border-primary/50 transition-colors cursor-pointer"
            onClick={() => navigate(`/league/${league.id}`)}
          >
            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2">
                <h4 className="font-semibold">{league.league_name}</h4>
                <Badge variant="outline">{league.platform.toUpperCase()}</Badge>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              </div>
              <p className="text-sm text-muted-foreground">
                {league.league_size} teams • {getDisplayScoringType(league).replace('_', ' ').toUpperCase()}
              </p>
              <p className="text-xs text-muted-foreground">
                Last synced: {new Date(league.last_synced_at).toLocaleString()}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => handleQuickResync(e, league.id, league.platform)}
              disabled={refreshingId === league.id}
              className="ml-4"
            >
              {refreshingId === league.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};