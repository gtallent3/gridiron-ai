import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, RefreshCw, Trash2, CheckCircle2, Download } from "lucide-react";

type League = {
  id: string;
  platform: string;
  league_name: string;
  league_size: number;
  scoring_type: string;
  scoring_settings?: any;
  auto_refresh: boolean;
  last_synced_at: string;
};

export const LeagueSettings = () => {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [backfillingId, setBackfillingId] = useState<string | null>(null);
  const [sleeperUsername, setSleeperUsername] = useState<string | null>(null);
  const { toast } = useToast();

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

  useEffect(() => {
    const loadUsername = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', user.id)
          .maybeSingle();
        if (data?.username) setSleeperUsername(data.username);
      }
    };
    loadUsername();
  }, []);

  const handleAutoRefreshToggle = async (leagueId: string, currentValue: boolean) => {
    try {
      const { error } = await supabase
        .from('connected_leagues')
        .update({ auto_refresh: !currentValue })
        .eq('id', leagueId);

      if (error) throw error;

      setLeagues(leagues.map(l => 
        l.id === leagueId ? { ...l, auto_refresh: !currentValue } : l
      ));

      toast({
        title: "Settings updated",
        description: `Auto-refresh ${!currentValue ? 'enabled' : 'disabled'}`,
      });
    } catch (error: any) {
      console.error('Error updating auto-refresh:', error);
      toast({
        title: "Error",
        description: "Failed to update settings",
        variant: "destructive",
      });
    }
  };

  const handleManualRefresh = async (leagueId: string, platform: string) => {
    setRefreshingId(leagueId);
    try {
      if (platform === 'espn') {
        // Use the resync edge function for ESPN
        const { data, error } = await supabase.functions.invoke('resync-espn-league', {
          body: { leagueId }
        });

        if (error) {
          // Check if credentials expired
          if (error.message?.includes('credentials') || error.message?.includes('expired')) {
            toast({
              title: "Credentials Expired",
              description: "Please reconnect your ESPN league with updated credentials",
              variant: "destructive",
            });
            return;
          }
          throw error;
        }

        toast({
          title: "✅ League Resynced",
          description: data.message || "Your ESPN league data has been updated",
        });
      } else if (platform === 'sleeper') {
        // Run the actual Sleeper sync using the user's profile username
        if (!sleeperUsername) {
          toast({
            title: 'Missing Username',
            description: 'Set your Sleeper username in your profile to sync.',
            variant: 'destructive',
          });
          return;
        }

        const { data, error } = await supabase.functions.invoke('sync-sleeper-league', {
          body: { username: sleeperUsername },
        });

        if (error) throw error;

        toast({
          title: '✅ Sleeper Synced',
          description: data?.message || 'Your Sleeper leagues have been updated',
        });
      } else {
        toast({
          title: "Coming Soon",
          description: `Manual refresh for ${platform.toUpperCase()} is not yet available`,
        });
        return;
      }

      await fetchLeagues();
    } catch (error: any) {
      console.error('Error refreshing league:', error);
      toast({
        title: "Resync Failed",
        description: error.message || "Failed to refresh league. Please try again.",
        variant: "destructive",
      });
    } finally {
      setRefreshingId(null);
    }
  };

  const handleBackfill = async (leagueId: string, platform: string) => {
    if (platform !== 'espn') {
      toast({
        title: "Not Supported",
        description: "Historical stat backfill is only available for ESPN leagues",
        variant: "destructive",
      });
      return;
    }

    setBackfillingId(leagueId);
    try {
      const { data, error } = await supabase.functions.invoke('backfill-espn-stats', {
        body: { 
          leagueId,
          startWeek: 1,
          endWeek: 7
        }
      });

      if (error) throw error;

      toast({
        title: "✅ Backfill Complete",
        description: `Loaded ${data.stats_inserted} historical stats for weeks 1-7`,
      });
    } catch (error: any) {
      console.error('Error backfilling stats:', error);
      toast({
        title: "Backfill Failed",
        description: error.message || "Failed to load historical stats",
        variant: "destructive",
      });
    } finally {
      setBackfillingId(null);
    }
  };

  const handleDisconnect = async (leagueId: string) => {
    try {
      const { error } = await supabase
        .from('connected_leagues')
        .delete()
        .eq('id', leagueId);

      if (error) throw error;

      setLeagues(leagues.filter(l => l.id !== leagueId));
      toast({
        title: "League disconnected",
        description: "League has been removed from your account",
      });
    } catch (error: any) {
      console.error('Error disconnecting league:', error);
      toast({
        title: "Error",
        description: "Failed to disconnect league",
        variant: "destructive",
      });
    }
  };


  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (leagues.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground mb-4">No leagues connected yet</p>
          <Button onClick={() => window.location.href = '/connect-league'} variant="glow">
            Connect Your First League
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">

      {/* Connected Leagues */}
      {leagues.map((league) => (
        <Card key={league.id}>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {league.league_name}
                  <Badge variant="outline" className="ml-2">
                    {league.platform.toUpperCase()}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {league.league_size} teams • {getDisplayScoringType(league).replace('_', ' ').toUpperCase()}
                </CardDescription>
              </div>
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor={`auto-refresh-${league.id}`}>Auto-refresh</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically sync league data daily
                </p>
              </div>
              <Switch
                id={`auto-refresh-${league.id}`}
                checked={league.auto_refresh}
                onCheckedChange={() => handleAutoRefreshToggle(league.id, league.auto_refresh)}
              />
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Last synced:</span>
              <span>
                {new Date(league.last_synced_at).toLocaleString()}
              </span>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => handleManualRefresh(league.id, league.platform)}
                disabled={refreshingId === league.id || backfillingId === league.id}
                variant="outline"
                size="sm"
              >
                {refreshingId === league.id ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Sync Current Week
                  </>
                )}
              </Button>
              {league.platform === 'espn' && (
                <Button
                  onClick={() => handleBackfill(league.id, league.platform)}
                  disabled={refreshingId === league.id || backfillingId === league.id}
                  variant="outline"
                  size="sm"
                >
                  {backfillingId === league.id ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      Load Weeks 1-7
                    </>
                  )}
                </Button>
              )}
              <Button
                onClick={() => handleDisconnect(league.id)}
                variant="destructive"
                size="sm"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Disconnect
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};