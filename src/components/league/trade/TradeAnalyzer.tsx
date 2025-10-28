import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowLeftRight, Sparkles, RefreshCw, Database, Coins } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { TradeRosterPanel } from "./TradeRosterPanel";
import { TradeEvaluation } from "./TradeEvaluation";
import { TradeEvaluationV3 } from "./TradeEvaluationV3";
import { enrichRosterWithValuations } from "@/lib/enrichRoster";
import { useTokens } from "@/hooks/useTokens";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";

type League = {
  id: string;
  platform: string;
  scoring_type: string;
};

type Team = {
  team_id: string;
  team_name: string;
  roster: any[];
  wins?: number;
  losses?: number;
  ties?: number;
  total_projected?: number;
};

type TradeAnalyzerProps = {
  league: League;
  userTeam: Team | null;
};

type Player = {
  id: string;
  name: string;
  position: string;
  team: string;
  projected: number;
  ros_projection?: number;
  ppg_projection?: number;
  status?: string;
  is_bye_week?: boolean;
  injury_status?: string | null;
  injury_duration_weeks?: number;
};

export function TradeAnalyzer({ league, userTeam }: TradeAnalyzerProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { hasUnlimited, checkBalance, deductToken } = useTokens();
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [mySelectedPlayers, setMySelectedPlayers] = useState<string[]>([]);
  const [theirSelectedPlayers, setTheirSelectedPlayers] = useState<string[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [tradeResult, setTradeResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [playerDataStatus, setPlayerDataStatus] = useState<{ count: number; lastUpdated: string | null } | null>(null);
  const [enrichedUserRoster, setEnrichedUserRoster] = useState<any[] | null>(null);

  // Position mapping for ESPN
  const POSITION_MAP: Record<number, string> = {
    1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF',
  };

  useEffect(() => {
    fetchAllTeams();
    checkPlayerDataStatus();
  }, [league.id]);

  const checkPlayerDataStatus = async () => {
    try {
      const { data, error } = await supabase
        .from('player_valuations')
        .select('last_updated_at', { count: 'exact' })
        .order('last_updated_at', { ascending: false })
        .limit(1);

      if (error) throw error;

      setPlayerDataStatus({
        count: data?.length || 0,
        lastUpdated: data?.[0]?.last_updated_at || null,
      });
    } catch (error) {
      console.error('Error checking player data status:', error);
    }
  };

  const handleSyncPlayerData = async () => {
    setIsSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-player-valuations');

      if (error) throw error;

      toast({
        title: "Player Data Synced",
        description: `Successfully synced ${data.count} players for Week ${data.week}`,
      });

      await checkPlayerDataStatus();
    } catch (error: any) {
      console.error('Error syncing player data:', error);
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync player data",
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (selectedTeamId) {
      const team = allTeams.find(t => t.team_id === selectedTeamId);
      setSelectedTeam(team || null);
    }
  }, [selectedTeamId, allTeams]);

  // Enrich user's roster with latest valuations for ROS/PPG
  useEffect(() => {
    (async () => {
      try {
        if (userTeam?.roster) {
          const enriched = await enrichRosterWithValuations(Array.isArray(userTeam.roster) ? userTeam.roster : []);
          setEnrichedUserRoster(enriched);
        } else {
          setEnrichedUserRoster(null);
        }
      } catch (e) {
        setEnrichedUserRoster(null);
      }
    })();
  }, [userTeam]);

  const fetchAllTeams = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('user_teams')
        .select('*')
        .eq('league_id', league.id);

      if (error) throw error;

      // Filter out current user's team and enrich rosters with valuations (dynamic week/season)
      const otherTeamsRaw = (data || []).filter(team => team.team_id !== userTeam?.team_id);
      const enriched = await Promise.all(otherTeamsRaw.map(async (team: any) => ({
        ...team,
        roster: await enrichRosterWithValuations(Array.isArray(team.roster) ? team.roster : [])
      })));

      setAllTeams(enriched as Team[]);
    } catch (error: any) {
      console.error('Error fetching teams:', error);
      toast({
        title: "Error",
        description: "Failed to load league teams",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const normalizeRoster = (roster: any[]): Player[] => {
    if (!Array.isArray(roster)) return [];

    return roster.map((player: any) => {
      const playerId = player.player_id || player.playerId || player.id;
      const playerName = player.player_name || player.playerName || player.name || 'Unknown Player';
      let positionName = POSITION_MAP[player.position] || player.position || 'FLEX';
      
      if (typeof positionName === 'number') {
        positionName = POSITION_MAP[positionName] || 'FLEX';
      }

      return {
        id: playerId,
        name: playerName,
        position: positionName.toString().toUpperCase(),
        team: player.team || 'NFL',
        projected: player.projected || 0,
        ros_projection: player.ros_projection || 0,
        ppg_projection: player.ppg_projection || 0,
        status: player.status,
        is_bye_week: player.is_bye_week || false,
        injury_status: player.injury_status || null,
        injury_duration_weeks: player.injury_duration_weeks || 0,
      };
    }).filter(p => p.id); // Filter out invalid players
  };

  const handleEvaluateTrade = async () => {
    if (mySelectedPlayers.length === 0 || theirSelectedPlayers.length === 0) {
      toast({
        title: "Selection Required",
        description: "Please select players from both teams to evaluate the trade",
        variant: "destructive",
      });
      return;
    }

    // Check token balance
    if (!hasUnlimited && !checkBalance(1)) {
      toast({
        title: "Insufficient Tokens",
        description: "You need 1 token for trade analysis",
        variant: "destructive",
      });
      setTimeout(() => navigate("/shop"), 2000);
      return;
    }

    setIsEvaluating(true);
    setTradeResult(null);

    try {
      const myRoster = normalizeRoster(userTeam?.roster || []);
      const theirRoster = normalizeRoster(selectedTeam?.roster || []);

      const myPlayers = myRoster.filter(p => mySelectedPlayers.includes(p.id));
      const theirPlayers = theirRoster.filter(p => theirSelectedPlayers.includes(p.id));

      // Extract player IDs for the new API
      const teamAGives = myPlayers.map(p => p.id);
      const teamBGives = theirPlayers.map(p => p.id);

      const { data, error } = await supabase.functions.invoke('evaluate-trade-v3', {
        body: {
          leagueId: league.id,
          teamAId: userTeam?.team_id || '',
          teamBId: selectedTeam?.team_id || '',
          teamAGives,
          teamBGives,
        }
      });

      if (error) throw error;

      // Deduct token after successful evaluation
      await deductToken(
        "trade_analysis", 
        `Trade: ${myPlayers.map(p => p.name).join(', ')} for ${theirPlayers.map(p => p.name).join(', ')}`
      );

      setTradeResult(data);
      
      toast({
        title: "Trade Evaluated",
        description: "AI analysis complete with Best Player Bonus",
      });
    } catch (error: any) {
      console.error('Error evaluating trade:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to evaluate trade",
        variant: "destructive",
      });
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleReset = () => {
    setMySelectedPlayers([]);
    setTheirSelectedPlayers([]);
    setTradeResult(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!userTeam) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No team data available. Please sync your league first.
        </CardContent>
      </Card>
    );
  }

  const myRoster = normalizeRoster((enrichedUserRoster || userTeam.roster || []));
  const theirRoster = selectedTeam ? normalizeRoster(selectedTeam.roster || []) : [];
  const userRecord = `${userTeam.wins || 0}-${userTeam.losses || 0}${userTeam.ties ? `-${userTeam.ties}` : ''}`;
  const otherRecord = selectedTeam ? `${selectedTeam.wins || 0}-${selectedTeam.losses || 0}${selectedTeam.ties ? `-${selectedTeam.ties}` : ''}` : '';

  return (
    <div className="space-y-6">
      {/* Sticky Header */}
      <Card className="sticky top-0 z-10 shadow-lg border-2 border-primary/50">
        <CardHeader>
          <div className="flex flex-col items-start gap-4">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 w-full">
              <div className="space-y-1">
                <CardTitle className="text-xl">Trade Analyzer</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Select players from both teams to evaluate potential trades
                </p>
              </div>
            
            <div className="flex items-center gap-3 flex-wrap">
              <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
                <SelectTrigger className="w-[250px]">
                  <SelectValue placeholder="Select opponent team" />
                </SelectTrigger>
                <SelectContent>
                  {allTeams.map(team => (
                    <SelectItem key={team.team_id} value={team.team_id}>
                      {team.team_name} ({team.wins || 0}-{team.losses || 0})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button 
                onClick={handleReset}
                variant="outline"
                disabled={mySelectedPlayers.length === 0 && theirSelectedPlayers.length === 0}
              >
                Reset
              </Button>

              <Button 
                onClick={handleEvaluateTrade}
                disabled={!selectedTeam || mySelectedPlayers.length === 0 || theirSelectedPlayers.length === 0 || isEvaluating}
                className="min-w-[140px]"
              >
                {isEvaluating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Evaluating...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Evaluate Trade
                  </>
                )}
              </Button>
            </div>
            </div>

            {/* Data Sync Status Bar */}
            <div className="flex items-center justify-between gap-4 pt-3 border-t">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Database className="h-4 w-4" />
                {playerDataStatus ? (
                  <span>
                    {playerDataStatus.count > 0 ? (
                      <>
                        Player data: {playerDataStatus.lastUpdated ? 
                          `Last synced ${new Date(playerDataStatus.lastUpdated).toLocaleDateString()}` 
                          : 'Available'}
                      </>
                    ) : (
                      <span className="text-destructive font-medium">No player data - sync required</span>
                    )}
                  </span>
                ) : (
                  <span>Checking data...</span>
                )}
              </div>
              
              <Button
                onClick={handleSyncPlayerData}
                variant="outline"
                size="sm"
                disabled={isSyncing}
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Sync Player Data
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Trade Summary */}
          {(mySelectedPlayers.length > 0 || theirSelectedPlayers.length > 0) && (
            <div className="mt-4 p-4 bg-accent/10 rounded-lg">
              <div className="flex items-center justify-center gap-4 flex-wrap text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Sending ({mySelectedPlayers.length})</span>
                </div>
                <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Receiving ({theirSelectedPlayers.length})</span>
                </div>
              </div>
            </div>
          )}
        </CardHeader>
      </Card>

      {/* Trade Result */}
      {tradeResult && (
        <>
          {tradeResult.trade_grade ? (
            <TradeEvaluationV3 result={tradeResult} myTeamId={userTeam.team_id} />
          ) : (
            <TradeEvaluation result={tradeResult} />
          )}
        </>
      )}

      {/* Roster Comparison */}
      {selectedTeam ? (
        <div className="grid md:grid-cols-2 gap-6">
          <TradeRosterPanel
            teamName={userTeam.team_name}
            teamRecord={userRecord}
            roster={myRoster}
            selectedPlayers={mySelectedPlayers}
            onPlayerToggle={(playerId) => {
              setMySelectedPlayers(prev =>
                prev.includes(playerId)
                  ? prev.filter(id => id !== playerId)
                  : [...prev, playerId]
              );
            }}
            side="left"
          />

          <TradeRosterPanel
            teamName={selectedTeam.team_name}
            teamRecord={otherRecord}
            roster={theirRoster}
            selectedPlayers={theirSelectedPlayers}
            onPlayerToggle={(playerId) => {
              setTheirSelectedPlayers(prev =>
                prev.includes(playerId)
                  ? prev.filter(id => id !== playerId)
                  : [...prev, playerId]
              );
            }}
            side="right"
          />
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Select a team above to start analyzing potential trades
          </CardContent>
        </Card>
      )}
    </div>
  );
}
