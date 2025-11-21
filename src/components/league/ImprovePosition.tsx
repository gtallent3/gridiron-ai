import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Users } from 'lucide-react';
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
            <Users className="w-5 h-5" />
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
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Trade with {pkg.partner_team_name}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-medium text-sm text-muted-foreground mb-2">
                      You Give
                    </h4>
                    <div className="space-y-2">
                      {pkg.my_gives.map((player, i) => (
                        <div key={i} className="flex items-center justify-between p-3 rounded-md bg-muted/50">
                          <div className="flex-1">
                            <p className="font-medium text-sm">{player.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {player.position} - {player.team}
                            </p>
                            <div className="flex gap-3 mt-1 text-xs">
                              <span className="text-muted-foreground">
                                Trade Value: <span className="font-medium text-foreground">{player.trade_value?.toFixed(1) || 0}</span>
                              </span>
                              <span className="text-muted-foreground">
                                Proj PPG: <span className="font-medium text-foreground">{player.projected_ppg?.toFixed(1) || 0}</span>
                              </span>
                            </div>
                          </div>
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
                        <div key={i} className="flex items-center justify-between p-3 rounded-md bg-primary/5 border border-primary/20">
                          <div className="flex-1">
                            <p className="font-medium text-sm">{player.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {player.position} - {player.team}
                            </p>
                            <div className="flex gap-3 mt-1 text-xs">
                              <span className="text-muted-foreground">
                                Trade Value: <span className="font-medium text-foreground">{player.trade_value?.toFixed(1) || 0}</span>
                              </span>
                              <span className="text-muted-foreground">
                                Proj PPG: <span className="font-medium text-foreground">{player.projected_ppg?.toFixed(1) || 0}</span>
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

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
