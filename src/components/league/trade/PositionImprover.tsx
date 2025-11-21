import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { TradeProposalCard } from "./TradeProposalCard";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type PositionImproverProps = {
  league: any;
  userTeam: any;
  allTeams: any[];
};

export function PositionImprover({ league, userTeam, allTeams }: PositionImproverProps) {
  const { toast } = useToast();
  const [targetPosition, setTargetPosition] = useState<string>("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

  const POSITION_MAP: Record<number, string> = {
    1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF',
  };

  const normalizePlayer = (player: any) => {
    const playerId = player.player_id || player.playerId || player.id;
    const playerName = player.player_name || player.playerName || player.name || 'Unknown';
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
    };
  };

  const handleImprovePosition = async () => {
    if (!targetPosition) {
      toast({
        title: "Selection Required",
        description: "Please select a position to improve",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const { data, error } = await supabase.functions.invoke('improve-position', {
        body: {
          targetPosition,
          leagueId: league.id,
          myTeam: {
            team_id: userTeam.team_id,
            roster: (userTeam.roster || []).map(normalizePlayer),
          },
          allTeams: allTeams.map(t => ({
            team_id: t.team_id,
            team_name: t.team_name,
            roster: (t.roster || []).map(normalizePlayer),
          })),
        },
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        },
      });

      if (error) throw error;

      setResult(data);
      
      toast({
        title: "Position Analysis Complete",
        description: `Found ${data.proposals?.length || 0} trade opportunities`,
      });
    } catch (error: any) {
      console.error('Error improving position:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to analyze position",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Position Improver</CardTitle>
          <p className="text-sm text-muted-foreground">
            Find trades to upgrade specific positions based on league average
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Select value={targetPosition} onValueChange={setTargetPosition}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select position to improve" />
              </SelectTrigger>
              <SelectContent>
                {positions.map(pos => (
                  <SelectItem key={pos} value={pos}>{pos}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button onClick={handleImprovePosition} disabled={loading || !targetPosition}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <TrendingUp className="mr-2 h-4 w-4" />
                  Analyze
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{targetPosition} Analysis</span>
                <Badge 
                  variant={result.currentRank <= 3 ? "default" : result.currentRank > 6 ? "destructive" : "secondary"}
                  className="text-base px-3 py-1"
                >
                  Rank {result.currentRank}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-center">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="cursor-help">
                        <div className="text-sm text-muted-foreground">Your PSS</div>
                        <div className="text-2xl font-bold">{result.currentPSS}</div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Position Strength Score - higher is better</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="cursor-help">
                        <div className="text-sm text-muted-foreground">Z-Score</div>
                        <div className={`text-2xl font-bold ${parseFloat(result.currentZScore) < 0 ? 'text-red-500' : 'text-green-500'}`}>
                          {result.currentZScore}
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Standard deviations from league average. Negative means below average.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="cursor-help">
                        <div className="text-sm text-muted-foreground">vs Median</div>
                        <div className={`text-2xl font-bold ${parseFloat(result.deltaVsMedian) < 0 ? 'text-red-500' : 'text-green-500'}`}>
                          {parseFloat(result.deltaVsMedian) >= 0 ? '+' : ''}{result.deltaVsMedian}
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Points difference vs league median at this position</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              {result.needsUpgrade && (
                <div className="mt-4">
                  <Badge variant={result.isVeryWeak ? "destructive" : "secondary"}>
                    {result.isVeryWeak ? '⚠️ Urgent Upgrade Needed' : 'Upgrade Recommended'}
                  </Badge>
                  <p className="text-sm text-muted-foreground mt-2">
                    Your {targetPosition} strength is {result.isVeryWeak ? 'significantly' : ''} below league average. Consider these trades:
                  </p>
                </div>
              )}

              {!result.needsUpgrade && (
                <div className="mt-4">
                  <Badge variant="default">✓ Strong Position</Badge>
                  <p className="text-sm text-muted-foreground mt-2">
                    Your {targetPosition} is performing well relative to the league. Trades below are optional depth moves.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {result.proposals && result.proposals.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Recommended Trades ({result.proposals.length})</h3>
                <p className="text-xs text-muted-foreground">Sorted by strategic fit & rank impact</p>
              </div>
              {result.proposals.map((proposal: any, idx: number) => (
                <TradeProposalCard key={idx} proposal={proposal} league={league} userTeam={userTeam} />
              ))}
            </div>
          )}
        </>
      )}

      {!loading && result && result.proposals?.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No viable trades found to improve this position. You may already be strong here, or other teams don't have the right surplus/needs.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
