import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlayerAutocomplete } from '@/components/ui/player-autocomplete';
import { Loader2, Sparkles, X, ArrowLeftRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useTokens } from '@/hooks/useTokens';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';

type League = {
  id: string;
  platform: string;
  scoring_type: string;
};

type Team = {
  team_id: string;
  team_name: string;
};

interface TradeAnalyzerROSProps {
  league: League;
  userTeam: Team | null;
}

interface SelectedPlayer {
  player_id: string;
  player_name: string;
  team: string;
  position: string;
}

export function TradeAnalyzerROS({ league, userTeam }: TradeAnalyzerROSProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { hasUnlimited, checkBalance, deductToken } = useTokens();

  const [sideAPlayers, setSideAPlayers] = useState<SelectedPlayer[]>([]);
  const [sideBPlayers, setSideBPlayers] = useState<SelectedPlayer[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [tradeResult, setTradeResult] = useState<any>(null);

  const handleAddPlayerA = (player: SelectedPlayer) => {
    if (!sideAPlayers.find(p => p.player_id === player.player_id)) {
      setSideAPlayers([...sideAPlayers, player]);
    }
  };

  const handleAddPlayerB = (player: SelectedPlayer) => {
    if (!sideBPlayers.find(p => p.player_id === player.player_id)) {
      setSideBPlayers([...sideBPlayers, player]);
    }
  };

  const handleRemovePlayerA = (playerId: string) => {
    setSideAPlayers(sideAPlayers.filter(p => p.player_id !== playerId));
  };

  const handleRemovePlayerB = (playerId: string) => {
    setSideBPlayers(sideBPlayers.filter(p => p.player_id !== playerId));
  };

  const handleEvaluate = async () => {
    if (sideAPlayers.length === 0 || sideBPlayers.length === 0) {
      toast({
        title: 'Selection Required',
        description: 'Please add players to both sides of the trade',
        variant: 'destructive',
      });
      return;
    }

    if (!hasUnlimited && !checkBalance(1)) {
      toast({
        title: 'Insufficient Tokens',
        description: 'You need 1 token for trade analysis',
        variant: 'destructive',
      });
      setTimeout(() => navigate('/shop'), 2000);
      return;
    }

    setIsEvaluating(true);
    setTradeResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('evaluate-trade-ros', {
        body: {
          leagueId: league.id,
          teamAId: userTeam?.team_id || 'team_a',
          teamBId: 'team_b',
          teamAGives: sideAPlayers.map(p => p.player_id),
          teamBGives: sideBPlayers.map(p => p.player_id),
        },
      });

      if (error) throw error;

      await deductToken(
        'trade_analysis',
        `ROS Trade: ${sideAPlayers.map(p => p.player_name).join(', ')} for ${sideBPlayers.map(p => p.player_name).join(', ')}`
      );

      setTradeResult(data);

      toast({
        title: 'Trade Evaluated',
        description: 'Weighted ROS analysis complete',
      });
    } catch (error: any) {
      console.error('Error evaluating trade:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to evaluate trade',
        variant: 'destructive',
      });
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleReset = () => {
    setSideAPlayers([]);
    setSideBPlayers([]);
    setTradeResult(null);
  };

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl">Trade Analyzer (Weighted ROS)</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Advanced rest-of-season player valuation with positional weighting
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleReset} variant="outline" size="sm">
                Reset
              </Button>
              <Button
                onClick={handleEvaluate}
                disabled={sideAPlayers.length === 0 || sideBPlayers.length === 0 || isEvaluating}
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
        </CardHeader>
      </Card>

      {/* Trade Result */}
      {tradeResult && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Trade Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Verdict */}
            <div className="text-center py-6 bg-accent/10 rounded-lg">
              <div className="text-3xl font-bold mb-2">{tradeResult.verdict}</div>
              {tradeResult.is_fair && (
                <Badge variant="outline" className="mt-2">Within ±5% - Fair Trade</Badge>
              )}
            </div>

            {/* Elite Player Bonus */}
            {tradeResult.best_player && (
              <div className="p-4 bg-primary/10 rounded-lg">
                <div className="font-semibold mb-2">⭐ Elite Player Bonus</div>
                <div className="text-sm">
                  <strong>{tradeResult.best_player.name}</strong> ({tradeResult.best_player.position}) - 
                  Weighted Value: {tradeResult.best_player.weighted_value.toFixed(1)}
                </div>
                {tradeResult.elite_bonus_received_by && (
                  <div className="text-sm text-muted-foreground mt-1">
                    +5% bonus to {tradeResult.elite_bonus_received_by}
                  </div>
                )}
              </div>
            )}

            {/* Breakdown */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Side A */}
              <div className="space-y-3">
                <div className="font-semibold text-lg border-b pb-2">Side A</div>
                <div>
                  <div className="text-sm text-muted-foreground mb-2">Gives:</div>
                  {tradeResult.team_a_breakdown.gives.map((player: any, i: number) => (
                    <div key={i} className="p-2 bg-accent/5 rounded mb-2 text-sm">
                      <div className="font-medium">{player.player_name} ({player.position})</div>
                      <div className="text-xs text-muted-foreground">
                        ROS: {player.ros_points.toFixed(1)} × {player.multiplier.toFixed(2)} = {player.weighted_value.toFixed(1)}
                      </div>
                    </div>
                  ))}
                  <div className="text-sm font-semibold mt-2">
                    Total: {tradeResult.team_a_breakdown.gives_total.toFixed(1)}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground mb-2">Receives:</div>
                  {tradeResult.team_a_breakdown.receives.map((player: any, i: number) => (
                    <div key={i} className="p-2 bg-primary/5 rounded mb-2 text-sm">
                      <div className="font-medium">{player.player_name} ({player.position})</div>
                      <div className="text-xs text-muted-foreground">
                        ROS: {player.ros_points.toFixed(1)} × {player.multiplier.toFixed(2)} = {player.weighted_value.toFixed(1)}
                        {player.depth_adjustment !== 0 && (
                          <span className="ml-2">
                            (Depth: {player.depth_adjustment > 0 ? '+' : ''}{player.depth_adjustment.toFixed(1)})
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="text-sm font-semibold mt-2">
                    Total: {tradeResult.team_a_breakdown.receives_total.toFixed(1)}
                  </div>
                </div>
                <div className={`text-lg font-bold ${tradeResult.team_a_breakdown.net_gain > 0 ? 'text-green-500' : 'text-red-500'}`}>
                  Net: {tradeResult.team_a_breakdown.net_gain > 0 ? '+' : ''}{tradeResult.team_a_breakdown.net_gain.toFixed(1)}
                </div>
              </div>

              {/* Side B */}
              <div className="space-y-3">
                <div className="font-semibold text-lg border-b pb-2">Side B</div>
                <div>
                  <div className="text-sm text-muted-foreground mb-2">Gives:</div>
                  {tradeResult.team_b_breakdown.gives.map((player: any, i: number) => (
                    <div key={i} className="p-2 bg-accent/5 rounded mb-2 text-sm">
                      <div className="font-medium">{player.player_name} ({player.position})</div>
                      <div className="text-xs text-muted-foreground">
                        ROS: {player.ros_points.toFixed(1)} × {player.multiplier.toFixed(2)} = {player.weighted_value.toFixed(1)}
                      </div>
                    </div>
                  ))}
                  <div className="text-sm font-semibold mt-2">
                    Total: {tradeResult.team_b_breakdown.gives_total.toFixed(1)}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground mb-2">Receives:</div>
                  {tradeResult.team_b_breakdown.receives.map((player: any, i: number) => (
                    <div key={i} className="p-2 bg-primary/5 rounded mb-2 text-sm">
                      <div className="font-medium">{player.player_name} ({player.position})</div>
                      <div className="text-xs text-muted-foreground">
                        ROS: {player.ros_points.toFixed(1)} × {player.multiplier.toFixed(2)} = {player.weighted_value.toFixed(1)}
                        {player.depth_adjustment !== 0 && (
                          <span className="ml-2">
                            (Depth: {player.depth_adjustment > 0 ? '+' : ''}{player.depth_adjustment.toFixed(1)})
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="text-sm font-semibold mt-2">
                    Total: {tradeResult.team_b_breakdown.receives_total.toFixed(1)}
                  </div>
                </div>
                <div className={`text-lg font-bold ${tradeResult.team_b_breakdown.net_gain > 0 ? 'text-green-500' : 'text-red-500'}`}>
                  Net: {tradeResult.team_b_breakdown.net_gain > 0 ? '+' : ''}{tradeResult.team_b_breakdown.net_gain.toFixed(1)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Player Selection */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Side A */}
        <Card className="overflow-visible">
          <CardHeader>
            <CardTitle className="text-lg">Side A - Gives</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 min-h-[300px] overflow-visible">
            <PlayerAutocomplete
              onSelectPlayer={handleAddPlayerA}
              placeholder="Search and add player..."
            />
            
            {sideAPlayers.length > 0 && (
              <div className="space-y-2">
                {sideAPlayers.map((player) => (
                  <div
                    key={player.player_id}
                    className="flex items-center justify-between p-3 bg-accent/10 rounded-lg"
                  >
                    <div>
                      <div className="font-medium">{player.player_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {player.team} • {player.position}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemovePlayerA(player.player_id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Side B */}
        <Card className="overflow-visible">
          <CardHeader>
            <CardTitle className="text-lg">Side B - Receives</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 min-h-[300px] overflow-visible">
            <PlayerAutocomplete
              onSelectPlayer={handleAddPlayerB}
              placeholder="Search and add player..."
            />
            
            {sideBPlayers.length > 0 && (
              <div className="space-y-2">
                {sideBPlayers.map((player) => (
                  <div
                    key={player.player_id}
                    className="flex items-center justify-between p-3 bg-accent/10 rounded-lg"
                  >
                    <div>
                      <div className="font-medium">{player.player_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {player.team} • {player.position}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemovePlayerB(player.player_id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
