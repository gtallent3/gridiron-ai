import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, AlertCircle, TrendingUp, TrendingDown, ArrowUp, ArrowDown } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TradeResultV3 {
  trade_grade: string;
  advantage_team: string;
  value_difference: number;
  percent_difference: number;
  best_player_received_by?: string;
  best_player_bonus?: number;
  positional_fit_notes?: string[];
  rank_changes?: Array<{
    team: string;
    position: string;
    beforeRank: number;
    beforeZ: number;
    player: string;
    action: string;
  }>;
  positional_fit_bonus_a?: number;
  positional_fit_bonus_b?: number;
  explanation: string;
  audit: {
    teamA_out: number;
    teamA_in: number;
    teamA_net: number;
    teamB_out: number;
    teamB_in: number;
    teamB_net: number;
  };
  players_traded?: {
    teamA_gives: Array<{
      id: string;
      name: string;
      position: string;
      trade_value: number;
      ppg_projection: number;
    }>;
    teamB_gives: Array<{
      id: string;
      name: string;
      position: string;
      trade_value: number;
      ppg_projection: number;
    }>;
  };
  ros_points_delta: number;
  next_3_weeks_delta: number;
  confidence: number;
  verdict: string;
  summary: string;
}

interface TradeEvaluationV3Props {
  result: TradeResultV3;
  myTeamId: string;
}

export function TradeEvaluationV3({ result, myTeamId }: TradeEvaluationV3Props) {
  const isMyAdvantage = result.advantage_team === myTeamId;
  const shouldAccept = result.verdict === 'accept';

  const getGradeColor = (grade: string) => {
    if (grade.startsWith('A')) return 'bg-green-500 text-white';
    if (grade.startsWith('B')) return 'bg-blue-500 text-white';
    if (grade.startsWith('C')) return 'bg-yellow-500 text-black';
    if (grade.startsWith('D')) return 'bg-orange-500 text-white';
    return 'bg-red-500 text-white';
  };

  const getVerdictIcon = () => {
    if (shouldAccept) return <CheckCircle2 className="w-6 h-6 text-green-500" />;
    return <XCircle className="w-6 h-6 text-red-500" />;
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Main Verdict Card */}
      <Card className="border-2">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {getVerdictIcon()}
              <div>
                <CardTitle className="text-xl">
                  {shouldAccept ? 'Recommend Accepting' : 'Recommend Rejecting'}
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Confidence: {result.confidence}%
                </p>
              </div>
            </div>
            <Badge className={`text-lg px-4 py-2 ${getGradeColor(result.trade_grade)}`}>
              Grade {result.trade_grade}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Value Difference */}
          <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Value Difference</p>
              <p className="text-2xl font-bold">
                {result.percent_difference >= 0 ? '+' : ''}
                {(result.percent_difference || 0).toFixed(1)}%
              </p>
            </div>
            {isMyAdvantage ? (
              <TrendingUp className="w-8 h-8 text-green-500" />
            ) : (
              <TrendingDown className="w-8 h-8 text-red-500" />
            )}
          </div>

          {/* Explanation */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-sm leading-relaxed">
              {result.explanation}
            </AlertDescription>
          </Alert>

          {/* Best Player Bonus */}
          {result.best_player_bonus > 0 && (
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-sm font-medium">
                🏆 Best Player Bonus: +{(result.best_player_bonus || 0).toFixed(1)} value
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Awarded to {result.best_player_received_by === myTeamId ? 'you' : 'opponent'} for receiving the highest-valued player
              </p>
            </div>
          )}

          {/* Positional Fit Notes */}
          {result.positional_fit_notes && result.positional_fit_notes.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Positional Fit Analysis:</p>
              {result.positional_fit_notes.map((note, idx) => (
                <div key={idx} className="flex items-start gap-2 text-sm">
                  <span className="text-muted-foreground">•</span>
                  <span>{note}</span>
                </div>
              ))}
            </div>
          )}

          {/* Rank Changes with Visual Indicators */}
          {result.rank_changes && result.rank_changes.length > 0 && (
            <div className="space-y-3 pt-3 border-t">
              <p className="text-sm font-medium">Positional Rank Impact:</p>
              <div className="grid gap-2">
                {result.rank_changes
                  .filter(change => change.action === 'receiving')
                  .map((change, idx) => (
                    <TooltipProvider key={idx}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-help">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="font-mono">
                                {change.position}
                              </Badge>
                              <span className="text-sm">
                                {change.team === 'A' ? 'You' : 'Opponent'} • {change.player}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">
                                Rank {change.beforeRank}
                              </span>
                              {change.beforeRank > 6 ? (
                                <ArrowUp className="w-4 h-4 text-green-500" />
                              ) : change.beforeRank <= 3 ? (
                                <ArrowDown className="w-4 h-4 text-red-500" />
                              ) : null}
                            </div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="space-y-1 text-xs">
                            <p>Current Rank: {change.beforeRank}</p>
                            <p>Z-Score: {(change.beforeZ || 0).toFixed(2)}</p>
                            <p className="text-muted-foreground">
                              {change.beforeRank > 6 ? 'Weak position - likely improves rank' : 
                               change.beforeRank <= 3 ? 'Strong position - may worsen with trade' :
                               'Average position'}
                            </p>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ))}
              </div>
            </div>
          )}

          {/* Positional Fit Bonuses */}
          {(result.positional_fit_bonus_a || result.positional_fit_bonus_b) && (
            <div className="grid sm:grid-cols-2 gap-3 pt-3 border-t">
              {result.positional_fit_bonus_a && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 cursor-help">
                        <p className="text-sm font-medium">
                          Your Position Fit: {result.positional_fit_bonus_a >= 0 ? '+' : ''}
                          {(result.positional_fit_bonus_a || 0).toFixed(1)}
                        </p>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">
                        Bonus/penalty based on how this trade addresses your positional needs
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {result.positional_fit_bonus_b && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="p-3 rounded-lg bg-muted/50 border cursor-help">
                        <p className="text-sm font-medium text-muted-foreground">
                          Opponent Position Fit: {result.positional_fit_bonus_b >= 0 ? '+' : ''}
                          {(result.positional_fit_bonus_b || 0).toFixed(1)}
                        </p>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">
                        Bonus/penalty for opponent based on their positional needs
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Player Trade Details */}
      {result.players_traded && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Players Traded</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-6">
              {/* Your Team Gives */}
              <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground">You Give:</p>
                <div className="space-y-2">
                  {result.players_traded.teamA_gives.map((player) => (
                    <div key={player.id} className="flex justify-between items-center p-2 rounded-lg bg-muted/30">
                      <div>
                        <p className="font-medium text-sm">{player.name}</p>
                        <p className="text-xs text-muted-foreground">{player.position} • {player.ppg_projection.toFixed(1)} PPG</p>
                      </div>
                      <Badge variant="outline" className="font-mono">
                        {player.trade_value.toFixed(1)}
                      </Badge>
                    </div>
                  ))}
                  <div className="flex justify-between items-center pt-2 border-t font-medium">
                    <span>Total Value:</span>
                    <span className="text-red-500">{result.audit.teamA_out.toFixed(1)}</span>
                  </div>
                </div>
              </div>

              {/* Your Team Receives */}
              <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground">You Receive:</p>
                <div className="space-y-2">
                  {result.players_traded.teamB_gives.map((player) => (
                    <div key={player.id} className="flex justify-between items-center p-2 rounded-lg bg-muted/30">
                      <div>
                        <p className="font-medium text-sm">{player.name}</p>
                        <p className="text-xs text-muted-foreground">{player.position} • {player.ppg_projection.toFixed(1)} PPG</p>
                      </div>
                      <Badge variant="outline" className="font-mono">
                        {player.trade_value.toFixed(1)}
                      </Badge>
                    </div>
                  ))}
                  <div className="flex justify-between items-center pt-2 border-t font-medium">
                    <span>Total Value:</span>
                    <span className="text-green-500">{result.audit.teamA_in.toFixed(1)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Net Value Change */}
            <div className="mt-4 p-4 rounded-lg bg-primary/5 border border-primary/20">
              <div className="flex justify-between items-center">
                <span className="font-semibold">Your Net Value Change:</span>
                <span className={`text-xl font-bold ${result.audit.teamA_net >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {result.audit.teamA_net >= 0 ? '+' : ''}{result.audit.teamA_net.toFixed(1)}
                </span>
              </div>
            </div>

            {/* ROS Projections */}
            <div className="mt-4 pt-4 border-t">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Rest of Season Impact</p>
                  <p className="text-lg font-bold">
                    {result.ros_points_delta >= 0 ? '+' : ''}
                    {(result.ros_points_delta || 0).toFixed(1)} pts
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Next 3 Weeks Impact</p>
                  <p className="text-lg font-bold">
                    {result.next_3_weeks_delta >= 0 ? '+' : ''}
                    {(result.next_3_weeks_delta || 0).toFixed(1)} pts
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
