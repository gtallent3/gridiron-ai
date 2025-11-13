import { useState } from "react";
import { ArrowRightLeft, TrendingUp, TrendingDown, Plus, X, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlayerAutocomplete } from "@/components/ui/player-autocomplete";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface TradePlayer {
  player_id: string;
  player_name: string;
  position: string;
  team: string;
  trade_value: number;
  avg_projected_ppg_ros: number;
}

export default function TradeAnalyzer() {
  const [sideA, setSideA] = useState<TradePlayer[]>([]);
  const [sideB, setSideB] = useState<TradePlayer[]>([]);
  const { toast } = useToast();

  const addPlayerToSide = async (side: 'A' | 'B', playerData: { player_id: string; player_name: string; team: string; position: string }) => {
    try {
      // Fetch full player data including trade_value from player_rankings
      const { data, error } = await supabase
        .from('player_rankings')
        .select('player_id, player_name, position, team, trade_value, avg_projected_ppg_ros')
        .eq('season', 2025)
        .eq('player_id', playerData.player_id)
        .single();

      if (error) throw error;
      if (!data) {
        toast({
          title: "Player not found",
          description: "This player doesn't have rankings data yet",
          variant: "destructive"
        });
        return;
      }

      const player: TradePlayer = {
        player_id: data.player_id,
        player_name: data.player_name,
        position: data.position,
        team: data.team,
        trade_value: data.trade_value || 0,
        avg_projected_ppg_ros: data.avg_projected_ppg_ros || 0
      };

      if (side === 'A') {
        if (sideA.find(p => p.player_id === player.player_id)) {
          toast({
            title: "Already added",
            description: "This player is already on Side A",
            variant: "destructive"
          });
          return;
        }
        setSideA([...sideA, player]);
      } else {
        if (sideB.find(p => p.player_id === player.player_id)) {
          toast({
            title: "Already added",
            description: "This player is already on Side B",
            variant: "destructive"
          });
          return;
        }
        setSideB([...sideB, player]);
      }
    } catch (error) {
      console.error('Error adding player:', error);
      toast({
        title: "Error",
        description: "Failed to add player",
        variant: "destructive"
      });
    }
  };

  const removePlayer = (side: 'A' | 'B', playerId: string) => {
    if (side === 'A') {
      setSideA(sideA.filter(p => p.player_id !== playerId));
    } else {
      setSideB(sideB.filter(p => p.player_id !== playerId));
    }
  };

  const calculateTotals = () => {
    const totalA = sideA.reduce((sum, p) => sum + p.trade_value, 0);
    const totalB = sideB.reduce((sum, p) => sum + p.trade_value, 0);
    
    const bestPlayerA = sideA.length > 0 ? Math.max(...sideA.map(p => p.trade_value)) : 0;
    const bestPlayerB = sideB.length > 0 ? Math.max(...sideB.map(p => p.trade_value)) : 0;
    
    let bonusA = 0;
    let bonusB = 0;
    
    if (bestPlayerA > bestPlayerB) {
      bonusA = bestPlayerA - bestPlayerB;
    } else if (bestPlayerB > bestPlayerA) {
      bonusB = bestPlayerB - bestPlayerA;
    }
    
    return {
      totalA: Math.round(totalA * 10) / 10,
      totalB: Math.round(totalB * 10) / 10,
      bonusA: Math.round(bonusA * 10) / 10,
      bonusB: Math.round(bonusB * 10) / 10,
      finalA: Math.round((totalA + bonusA) * 10) / 10,
      finalB: Math.round((totalB + bonusB) * 10) / 10,
      bestPlayerA,
      bestPlayerB
    };
  };

  const totals = calculateTotals();
  const difference = totals.finalA - totals.finalB;
  const winner = difference > 0 ? 'A' : difference < 0 ? 'B' : 'tie';

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="text-center space-y-4 mb-8">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/30 bg-primary/5">
          <ArrowRightLeft className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-primary">Trade Evaluation</span>
        </div>
        <h1 className="text-4xl font-bold">Trade Analyzer</h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          Compare players on both sides of a trade using real-time rankings data with best player bonus calculations
        </p>
      </div>

      {/* Trade Comparison Grid */}
      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        {/* Side A */}
        <Card className="border-2 border-border/50 bg-gradient-to-br from-card to-secondary/20">
          <CardHeader className="border-b border-border/50">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-xl">
                <TrendingDown className="h-5 w-5 text-blue-500" />
                Side A
              </CardTitle>
              <Badge variant="outline" className="text-lg font-bold px-4 py-1">
                {totals.finalA}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            {/* Add Player Input */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Add Player</label>
              <PlayerAutocomplete
                onSelectPlayer={(player) => addPlayerToSide('A', player)}
                placeholder="Search and add players..."
              />
            </div>

            {/* Players List */}
            {sideA.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Plus className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No players added yet</p>
                <p className="text-sm">Search and add players above</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sideA.map((player) => (
                  <div
                    key={player.player_id}
                    className="group relative p-4 rounded-lg bg-card border border-border/50 hover:border-primary/50 transition-all"
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => removePlayer('A', player.player_id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <div className="flex items-start justify-between pr-8">
                      <div className="space-y-1">
                        <div className="font-semibold text-lg">{player.player_name}</div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {player.position}
                          </Badge>
                          <span className="text-sm text-muted-foreground">{player.team}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-primary">{player.trade_value}</div>
                        <div className="text-xs text-muted-foreground">Value</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-sm pt-3 mt-3 border-t border-border/30">
                      <span className="text-muted-foreground">Projected PPG</span>
                      <span className="font-semibold">{player.avg_projected_ppg_ros.toFixed(1)}</span>
                    </div>
                  </div>
                ))}

                {/* Totals Breakdown */}
                <div className="pt-4 border-t-2 border-border space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Base Value</span>
                    <span className="font-semibold">{totals.totalA}</span>
                  </div>
                  {totals.bonusA > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Trophy className="h-3 w-3 text-yellow-500" />
                        Best Player Bonus
                      </span>
                      <span className="font-semibold text-green-600">+{totals.bonusA}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between font-bold text-lg pt-2 border-t border-border/50">
                    <span>Final Value</span>
                    <span className="text-primary">{totals.finalA}</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Side B */}
        <Card className="border-2 border-border/50 bg-gradient-to-br from-card to-secondary/20">
          <CardHeader className="border-b border-border/50">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-xl">
                <TrendingUp className="h-5 w-5 text-green-500" />
                Side B
              </CardTitle>
              <Badge variant="outline" className="text-lg font-bold px-4 py-1">
                {totals.finalB}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            {/* Add Player Input */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Add Player</label>
              <PlayerAutocomplete
                onSelectPlayer={(player) => addPlayerToSide('B', player)}
                placeholder="Search and add players..."
              />
            </div>

            {/* Players List */}
            {sideB.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Plus className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No players added yet</p>
                <p className="text-sm">Search and add players above</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sideB.map((player) => (
                  <div
                    key={player.player_id}
                    className="group relative p-4 rounded-lg bg-card border border-border/50 hover:border-primary/50 transition-all"
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => removePlayer('B', player.player_id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <div className="flex items-start justify-between pr-8">
                      <div className="space-y-1">
                        <div className="font-semibold text-lg">{player.player_name}</div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {player.position}
                          </Badge>
                          <span className="text-sm text-muted-foreground">{player.team}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-primary">{player.trade_value}</div>
                        <div className="text-xs text-muted-foreground">Value</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-sm pt-3 mt-3 border-t border-border/30">
                      <span className="text-muted-foreground">Projected PPG</span>
                      <span className="font-semibold">{player.avg_projected_ppg_ros.toFixed(1)}</span>
                    </div>
                  </div>
                ))}

                {/* Totals Breakdown */}
                <div className="pt-4 border-t-2 border-border space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Base Value</span>
                    <span className="font-semibold">{totals.totalB}</span>
                  </div>
                  {totals.bonusB > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Trophy className="h-3 w-3 text-yellow-500" />
                        Best Player Bonus
                      </span>
                      <span className="font-semibold text-green-600">+{totals.bonusB}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between font-bold text-lg pt-2 border-t border-border/50">
                    <span>Final Value</span>
                    <span className="text-primary">{totals.finalB}</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Trade Verdict */}
      {(sideA.length > 0 || sideB.length > 0) && (
        <Card className={`border-2 ${
          winner === 'A' ? 'border-blue-500/50 bg-blue-500/5' :
          winner === 'B' ? 'border-green-500/50 bg-green-500/5' :
          'border-yellow-500/50 bg-yellow-500/5'
        }`}>
          <CardContent className="py-6">
            <div className="text-center space-y-3">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-background/50 border border-border">
                {winner === 'tie' ? (
                  <>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                      <span className="font-semibold text-yellow-600 dark:text-yellow-400">Even Trade</span>
                    </div>
                  </>
                ) : (
                  <>
                    <Trophy className={`h-4 w-4 ${winner === 'A' ? 'text-blue-500' : 'text-green-500'}`} />
                    <span className="font-semibold">Side {winner} Wins</span>
                  </>
                )}
              </div>
              
              {winner !== 'tie' && (
                <div className="text-2xl font-bold">
                  by {Math.abs(difference).toFixed(1)} points
                </div>
              )}
              
              {(totals.bonusA > 0 || totals.bonusB > 0) && (
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Best Player Bonus awarded to Side {totals.bonusA > 0 ? 'A' : 'B'} for having the highest value player
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
