import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, TrendingUp, Users, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface ImprovePositionProps {
  leagueId: string;
  myTeamId: string;
  myTeam: any;
  allTeams: any[];
  onTradeSelected?: (trade: any) => void;
}

interface TradePackage {
  partner_team_id: string;
  partner_team_name: string;
  my_gives: any[];
  i_receive: any[];
  value_delta: number;
  
  // PRIMARY: Net value gain
  net_value_gain: number;
  
  // Enhanced metrics
  my_pos_rank_before?: number;
  my_pos_rank_after?: number;
  rank_improvement?: number;
  pss_delta?: number;
  
  opponent_pos?: string;
  opponent_pos_rank_before?: number;
  opponent_pos_rank_after?: number;
  opponent_pss_delta?: number;
  opponent_rank_change?: number;
  
  trade_fit_score?: number;
  grade?: string;
  mutual_benefit?: boolean;
  acceptance_likelihood?: string;
  
  explanation: string;
  positional_gain: number;
}

export function ImprovePosition({ 
  leagueId, 
  myTeamId, 
  myTeam, 
  allTeams,
  onTradeSelected 
}: ImprovePositionProps) {
  const [selectedPosition, setSelectedPosition] = useState<string>('RB');
  const [packages, setPackages] = useState<TradePackage[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const positions = ['QB', 'RB', 'WR', 'TE'];

  const handleAnalyze = async () => {
    try {
      setIsAnalyzing(true);
      
      const { data, error } = await supabase.functions.invoke('improve-position', {
        body: {
          targetPosition: selectedPosition,
          leagueId,
          myTeam,
          allTeams,
          leagueSettings: {},
        },
      });

      if (error) throw error;

        // Map the proposals to match expected structure
      const mappedProposals = (data?.proposals || []).map((p: any) => ({
        partner_team_id: p.theirTeam?.team_id,
        partner_team_name: p.theirTeam?.team_name || 'Unknown Team',
        my_gives: p.myPlayers || [],
        i_receive: p.theirPlayers || [],
        value_delta: p.valueDiff || 0,
        
        // PRIMARY: Net value gain
        net_value_gain: p.net_value_gain || 0,
        
        // Enhanced metrics
        my_pos_rank_before: p.my_pos_rank_before,
        my_pos_rank_after: p.my_pos_rank_after,
        rank_improvement: p.my_pos_rank_before - p.my_pos_rank_after,
        pss_delta: p.pss_delta,
        
        opponent_pos: p.opponent_improved_position,
        opponent_pos_rank_before: p.opponent_pos_rank_before,
        opponent_pos_rank_after: p.opponent_pos_rank_after,
        opponent_pss_delta: p.opponent_pss_delta,
        opponent_rank_change: p.opponent_rank_change,
        
        trade_fit_score: p.trade_fit_score,
        grade: p.grade,
        mutual_benefit: p.mutual_benefit,
        acceptance_likelihood: p.acceptance_likelihood || 'Medium',
        
        explanation: p.rationale || '',
        positional_gain: p.pss_delta || 0,
      }));

      setPackages(mappedProposals);
      
      if (mappedProposals.length === 0) {
        toast.info('No suitable trade packages found for this position');
      } else {
        toast.success(`Found ${mappedProposals.length} trade packages`);
      }
    } catch (error) {
      console.error('Error finding trades:', error);
      toast.error('Failed to find trade packages');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Improve a Position
          </CardTitle>
          <CardDescription>
            Find trades that strengthen a weak position on your roster
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">
                Position to Improve
              </label>
              <Select value={selectedPosition} onValueChange={setSelectedPosition}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {positions.map(pos => (
                    <SelectItem key={pos} value={pos}>
                      {pos}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleAnalyze} disabled={isAnalyzing}>
              {isAnalyzing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Find Trades
            </Button>
          </div>
        </CardContent>
      </Card>

      {packages.length > 0 && (
        <div className="grid gap-4">
          {packages.map((pkg, idx) => (
            <Card key={idx} className="hover:border-primary/50 transition-colors">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-3">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Users className="w-4 h-4" />
                        Trade with {pkg.partner_team_name}
                      </CardTitle>
                    </div>
                    
                    {/* PRIMARY: Net Value Gain */}
                    <div className="flex items-center gap-4 mb-3 p-3 bg-primary/10 rounded-lg">
                      <div className="flex-1">
                        <div className="text-xs text-muted-foreground mb-1">Net ROS Value Gain</div>
                        <div className="text-2xl font-bold text-primary">
                          +{pkg.net_value_gain.toFixed(1)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {pkg.acceptance_likelihood === 'High' && (
                          <CheckCircle2 className="h-5 w-5 text-green-500" />
                        )}
                        {pkg.acceptance_likelihood === 'Medium' && (
                          <AlertCircle className="h-5 w-5 text-yellow-500" />
                        )}
                        {pkg.acceptance_likelihood === 'Low' && (
                          <AlertCircle className="h-5 w-5 text-red-500" />
                        )}
                        <div className="text-sm">
                          <div className="font-medium">{pkg.acceptance_likelihood}</div>
                          <div className="text-xs text-muted-foreground">Acceptance</div>
                        </div>
                      </div>
                    </div>
                    
                    {/* SECONDARY: Positional Context */}
                    <div className="bg-muted/50 rounded-lg p-3 mb-3">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <div className="text-muted-foreground mb-1 text-xs">📈 Your {selectedPosition} Rank</div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">#{pkg.my_pos_rank_before}</span>
                            <ArrowRight className="h-3 w-3" />
                            <span className="font-bold text-primary">#{pkg.my_pos_rank_after}</span>
                            {pkg.rank_improvement && pkg.rank_improvement > 0 && (
                              <span className="text-xs text-green-600">
                                (+{pkg.rank_improvement})
                              </span>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground mb-1 text-xs">🤝 Partner Rank Impact</div>
                          <div className="font-medium text-xs">
                            {pkg.opponent_pos} rank {pkg.opponent_rank_change !== undefined && pkg.opponent_rank_change >= 0 ? 'drops' : 'improves'} by {Math.abs(pkg.opponent_rank_change || 0)}
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <CardDescription className="text-xs">
                      {pkg.explanation}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-medium text-sm text-muted-foreground mb-2">
                      You Give
                    </h4>
                    <div className="space-y-2">
                      {pkg.my_gives.map((player, i) => (
                        <div key={i} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                          <div>
                            <p className="font-medium text-sm">{player.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {player.position} - {player.team}
                            </p>
                          </div>
                          <Badge variant="outline">{player.value?.toFixed(1) || 0}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="font-medium text-sm text-muted-foreground mb-2">
                      You Receive
                    </h4>
                    <div className="space-y-2">
                      {pkg.i_receive.map((player, i) => (
                        <div key={i} className="flex items-center justify-between p-2 rounded-md bg-primary/5 border border-primary/20">
                          <div>
                            <p className="font-medium text-sm">{player.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {player.position} - {player.team}
                            </p>
                          </div>
                          <Badge variant="outline">{player.value?.toFixed(1) || 0}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Mutual Benefit Analysis */}
                {pkg.opponent_pos && pkg.opponent_pss_delta !== undefined && (
                  <div className="mt-4 pt-4 border-t">
                    <h4 className="text-sm font-medium mb-2">Why They'd Accept:</h4>
                    <div className="text-sm text-muted-foreground flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-green-500" />
                      <span>
                        Improves their {pkg.opponent_pos} from rank {pkg.opponent_pos_rank_before} → {pkg.opponent_pos_rank_after}
                        {pkg.opponent_pss_delta > 0 && ` (+${pkg.opponent_pss_delta.toFixed(1)} PSS)`}
                      </span>
                    </div>
                  </div>
                )}

                {onTradeSelected && (
                  <Button 
                    className="w-full mt-4" 
                    variant="outline"
                    onClick={() => onTradeSelected(pkg)}
                  >
                    Evaluate This Trade
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
