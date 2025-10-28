import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, TrendingUp, Users } from 'lucide-react';
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
        explanation: p.rationale || '',
        positional_gain: p.positionGain || 0,
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
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Trade with {pkg.partner_team_name}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {pkg.explanation}
                    </CardDescription>
                  </div>
                  <Badge variant={pkg.value_delta >= 0 ? 'default' : 'secondary'}>
                    {pkg.value_delta >= 0 ? '+' : ''}
                    {pkg.value_delta.toFixed(1)} value
                  </Badge>
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
                        <div key={i} className="flex items-center justify-between p-2 rounded-md bg-primary/5">
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
