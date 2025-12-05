import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlayerCard } from "./PlayerCard";
import { Sparkles, Plus, Minus, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type League = {
  id: string;
  current_week: number;
  scoring_type: string;
};

type Team = {
  id: string;
  team_id: string;
  team_name: string;
  roster: any;
};

type WaiverWireProps = {
  league: League;
  userTeam: Team | null;
  allTeams: Team[];
};

type WaiverPlayer = {
  id: string;
  name: string;
  position: string;
  team: string;
  projected: number;
  opponent?: string;
  oppDefRank?: number;
  byeWeek?: boolean;
  recommendation?: {
    reasoning: string;
    projectedGain: number;
    dropPlayer: string | null;
  };
};

const normalizePlayerName = (name: string | null | undefined): string => {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[.,']/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

export function WaiverWire({ league, userTeam, allTeams }: WaiverWireProps) {
  const { toast } = useToast();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [recommendations, setRecommendations] = useState<WaiverPlayer[]>([]);
  const [selectedAction, setSelectedAction] = useState<{ type: 'add' | 'drop', player: WaiverPlayer } | null>(null);
  const [waiverPlayers, setWaiverPlayers] = useState<WaiverPlayer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPosition, setSelectedPosition] = useState<string>('ALL');

  useEffect(() => {
    fetchWaiverPlayers();
  }, [league.id]);

  const fetchWaiverPlayers = async () => {
    try {
      setIsLoading(true);
      
      // Get current season
      const now = new Date();
      const currentSeason = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
      const currentWeek = league.current_week || 1;

      // Fetch ALL teams in this specific league to get complete roster data
      const { data: teamsData, error: teamsError } = await supabase
        .from('user_teams')
        .select('roster')
        .eq('league_id', league.id);

      if (teamsError) throw teamsError;

      // Extract all rostered canonical_player_ids from ALL teams in the league
      const rosteredCanonicalIds = new Set<string>();
      const rosteredEspnIds = new Set<string>();
      const rosteredNames = new Set<string>();
      
      (teamsData || []).forEach((team) => {
        const roster = Array.isArray(team?.roster) ? team.roster : [];
        roster.forEach((player: any) => {
          if (player?.canonical_player_id) {
            rosteredCanonicalIds.add(String(player.canonical_player_id));
          }
          if (player?.espn_id != null) {
            rosteredEspnIds.add(String(player.espn_id));
          }
          if (player?.player_name) {
            rosteredNames.add(normalizePlayerName(player.player_name));
          }
        });
      });

      console.log(`Found ${rosteredCanonicalIds.size} rostered players across ${teamsData?.length} teams`);

      // Fetch available players from player_pool_v2
      const { data, error } = await supabase
        .from('player_pool_v2')
        .select(`
          canonical_player_id,
          player_name,
          position,
          team,
          projected_fp,
          opponent,
          opponent_def_rank,
          bye_week,
          raw_source_ids,
          canonical_players!inner(id, player_name, position, team, espn_id)
        `)
        .eq('season', currentSeason)
        .eq('week', currentWeek)
        .not('projected_fp', 'is', null)
        .not('position', 'in', '(K,D/ST)')
        .order('projected_fp', { ascending: false })
        .limit(500);

      if (error) throw error;

      // Filter out rostered players using multiple identifiers and map to WaiverPlayer format
      const availablePlayers = (data || [])
        .filter((p: any) => {
          const canonicalId = p.canonical_player_id ? String(p.canonical_player_id) : null;
          const rawSourceIds = (p as any).raw_source_ids as any;
          const canonicalPlayers = (p as any).canonical_players as any;

          const rawEspnId = rawSourceIds?.espn_id ?? rawSourceIds?.espn ?? canonicalPlayers?.espn_id;
          const espnId = rawEspnId != null ? String(rawEspnId) : null;

          const playerName = normalizePlayerName(p.player_name || canonicalPlayers?.player_name);

          const isRosteredByCanonical = canonicalId !== null && rosteredCanonicalIds.has(canonicalId);
          const isRosteredByEspn = espnId !== null && rosteredEspnIds.has(espnId);
          const isRosteredByName = playerName !== '' && rosteredNames.has(playerName);

          return !(isRosteredByCanonical || isRosteredByEspn || isRosteredByName);
        })
        .map((p: any) => ({
          id: p.canonical_player_id,
          name: p.player_name || p.canonical_players?.player_name || 'Unknown',
          position: p.position,
          team: p.team || 'FA',
          opponent: p.opponent || 'N/A',
          oppDefRank: p.opponent_def_rank,
          byeWeek: p.bye_week || false,
          projected: typeof p.projected_fp === 'number' ? Number(p.projected_fp.toFixed(1)) : 0,
        }))
        .filter((p: WaiverPlayer) => p.projected > 0);

      setWaiverPlayers(availablePlayers);
    } catch (error) {
      console.error('Error fetching waiver players:', error);
      toast({
        title: "Error",
        description: "Failed to load waiver wire players",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const positions = ['ALL', 'QB', 'RB', 'WR', 'TE'];
  
  const filteredPlayers = selectedPosition === 'ALL' 
    ? waiverPlayers 
    : waiverPlayers.filter(p => p.position === selectedPosition);

  const analyzeWaivers = async () => {
    if (!userTeam?.roster) {
      toast({
        title: "Error",
        description: "Could not load your roster for analysis",
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('analyze-waivers', {
        body: {
          roster: userTeam.roster,
          waiverPlayers: waiverPlayers,
          currentWeek: league.current_week,
        },
      });

      if (error) throw error;

      const aiRecommendations = (data.recommendations || []).map((rec: any) => {
        const player = waiverPlayers.find(p => p.name === rec.playerToAdd);
        if (!player) return null;
        
        return {
          ...player,
          recommendation: {
            reasoning: rec.reasoning,
            projectedGain: rec.projectedGain || 0,
            dropPlayer: rec.playerToDrop,
          }
        };
      }).filter(Boolean);

      setRecommendations(aiRecommendations);
      
      toast({
        title: "Waiver Analysis Complete",
        description: `Found ${aiRecommendations.length} recommendation${aiRecommendations.length !== 1 ? 's' : ''}`,
      });
    } catch (error) {
      console.error('Error analyzing waivers:', error);
      toast({
        title: "Analysis Failed",
        description: "Could not complete waiver analysis. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAddPlayer = (player: WaiverPlayer) => {
    setSelectedAction({ type: 'add', player });
  };

  const handleDropPlayer = (player: WaiverPlayer) => {
    setSelectedAction({ type: 'drop', player });
  };

  const confirmAction = () => {
    if (!selectedAction) return;
    
    const action = selectedAction.type === 'add' ? 'added' : 'dropped';
    toast({
      title: `Player ${action}`,
      description: `${selectedAction.player.name} has been ${action} to your team`,
    });
    
    setSelectedAction(null);
  };

  return (
    <div className="space-y-6">
      <Card className="border-2 border-accent/50 bg-gradient-to-br from-accent/5 to-primary/5">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                <span className="hidden sm:inline">AI Waiver Recommendations</span>
                <span className="sm:hidden">AI Waivers</span>
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm mt-1">
                <span className="hidden sm:inline">Get AI-powered add/drop suggestions</span>
                <span className="sm:hidden">AI-powered suggestions</span>
              </CardDescription>
            </div>
            <Button
              onClick={analyzeWaivers} 
              disabled={isAnalyzing}
              variant="glow"
              size="sm"
              className="w-full sm:w-auto"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  <span className="hidden sm:inline">Analyzing...</span>
                  <span className="sm:hidden">Loading</span>
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Analyze
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-6">
          {recommendations.length === 0 ? (
            <div className="text-center py-6 sm:py-8 text-muted-foreground text-sm">
              <p className="hidden sm:block">Click "Analyze" to get AI-powered recommendations</p>
              <p className="sm:hidden">Tap Analyze for AI picks</p>
            </div>
          ) : (
            <div className="space-y-3 sm:space-y-4">
              {recommendations.map((player) => (
                <Card key={player.id} className="bg-background/50 border-green-500/30">
                  <CardContent className="p-3 sm:p-4">
                    <div className="space-y-2 sm:space-y-3">
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-3">
                        <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20 text-[10px] sm:text-xs">
                          ADD
                        </Badge>
                        <span className="font-semibold text-sm sm:text-lg">{player.name}</span>
                        <Badge className="text-[10px] sm:text-xs">{player.position}</Badge>
                        <span className="text-xs sm:text-sm text-muted-foreground">{player.team}</span>
                      </div>
                      
                      {player.recommendation && (
                        <>
                          <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 sm:line-clamp-none">
                            {player.recommendation.reasoning}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs sm:text-sm">
                            {player.recommendation.projectedGain > 0 && (
                              <span className="text-green-500 font-semibold">
                                +{player.recommendation.projectedGain} pts
                              </span>
                            )}
                            {player.recommendation.dropPlayer && (
                              <span className="text-muted-foreground">
                                Drop: {player.recommendation.dropPlayer}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3">
            <div>
              <CardTitle className="text-base sm:text-lg">Free Agents</CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Top available players
              </CardDescription>
            </div>
            <div className="flex gap-1.5 sm:gap-2 flex-wrap">
              {positions.map((pos) => (
                <Button
                  key={pos}
                  variant={selectedPosition === pos ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2 sm:h-8 sm:px-3 text-xs sm:text-sm"
                  onClick={() => setSelectedPosition(pos)}
                >
                  {pos}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredPlayers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No {selectedPosition === 'ALL' ? '' : selectedPosition + ' '}players available{waiverPlayers.length === 0 ? '. Try resyncing your league from the home page.' : ' for this position.'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="text-left p-2 sm:p-3 font-medium">Player</th>
                    <th className="text-center p-2 sm:p-3 font-medium hidden sm:table-cell">Team</th>
                    <th className="text-center p-2 sm:p-3 font-medium hidden md:table-cell">Matchup</th>
                    <th className="text-center p-2 sm:p-3 font-medium">Rank</th>
                    <th className="text-right p-2 sm:p-3 font-medium">Proj</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPlayers.filter(p => p && p.name).map((player, index) => (
                    <tr 
                      key={player.id} 
                      className={`border-b hover:bg-muted/30 transition-colors ${index % 2 === 0 ? 'bg-background' : 'bg-muted/10'}`}
                    >
                      <td className="p-2 sm:p-3">
                        <div className="flex flex-col">
                          <span className="font-medium text-xs sm:text-sm">{player.name}</span>
                          <span className="text-xs text-muted-foreground sm:hidden">
                            {player.position} • {player.team}
                            {player.byeWeek && ' • BYE'}
                          </span>
                        </div>
                        <Badge variant="outline" className="hidden sm:inline-flex text-xs mt-1">{player.position}</Badge>
                        {player.byeWeek && (
                          <Badge variant="secondary" className="ml-1 text-xs hidden sm:inline-flex">BYE</Badge>
                        )}
                      </td>
                      <td className="p-2 sm:p-3 text-center text-muted-foreground hidden sm:table-cell text-xs sm:text-sm">{player.team}</td>
                      <td className="p-2 sm:p-3 text-center text-muted-foreground hidden md:table-cell text-xs sm:text-sm">
                        {player.byeWeek ? '-' : `vs ${player.opponent}`}
                      </td>
                      <td className="p-2 sm:p-3 text-center">
                        {player.byeWeek ? (
                          <span className="text-muted-foreground text-xs">-</span>
                        ) : player.oppDefRank ? (
                          <Badge 
                            variant={
                              player.oppDefRank >= 23 ? "outline" : 
                              player.oppDefRank >= 11 ? "secondary" : 
                              "destructive"
                            }
                            className={`text-xs ${
                              player.oppDefRank >= 23 ? "bg-green-500/10 text-green-600 border-green-500/30" : 
                              ""
                            }`}
                          >
                            #{player.oppDefRank}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </td>
                      <td className="p-2 sm:p-3 text-right font-semibold text-xs sm:text-sm">{player.projected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!selectedAction} onOpenChange={() => setSelectedAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selectedAction?.type === 'add' ? 'Add Player' : 'Drop Player'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {selectedAction?.type === 'add' 
                ? `Are you sure you want to add ${selectedAction?.player?.name ?? 'this player'} to your roster?`
                : `Are you sure you want to drop ${selectedAction?.player?.name ?? 'this player'} from your roster?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmAction}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
