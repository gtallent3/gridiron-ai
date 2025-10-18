import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { TradeProposalCard } from "./TradeProposalCard";
import { Badge } from "@/components/ui/badge";

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
        }
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
              <CardTitle>{targetPosition} Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-sm text-muted-foreground">Your Strength</div>
                  <div className="text-2xl font-bold">{result.myPosStrength}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">League Average</div>
                  <div className="text-2xl font-bold">{result.leagueAvgPos}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Gap</div>
                  <div className={`text-2xl font-bold ${parseFloat(result.posStrengthGap) > 0 ? 'text-red-500' : 'text-green-500'}`}>
                    {result.posStrengthGap}
                  </div>
                </div>
              </div>
              
              {result.needsUpgrade && (
                <div className="mt-4">
                  <Badge variant="destructive">Upgrade Recommended</Badge>
                  <p className="text-sm text-muted-foreground mt-2">
                    Your {targetPosition} strength is below league average. Consider these trades:
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {result.proposals && result.proposals.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-semibold">Recommended Trades ({result.proposals.length})</h3>
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
