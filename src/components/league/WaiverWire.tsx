import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlayerCard } from "./PlayerCard";
import { FetchProjections } from "./FetchProjections";
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
};

type WaiverWireProps = {
  league: League;
};

type WaiverPlayer = {
  id: string;
  name: string;
  position: string;
  team: string;
  projected: number;
  recommendation?: {
    reasoning: string;
    projectedGain: number;
    dropPlayer: string;
  };
};

export function WaiverWire({ league }: WaiverWireProps) {
  const { toast } = useToast();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [recommendations, setRecommendations] = useState<WaiverPlayer[]>([]);
  const [selectedAction, setSelectedAction] = useState<{ type: 'add' | 'drop', player: WaiverPlayer } | null>(null);
  const [waiverPlayers, setWaiverPlayers] = useState<WaiverPlayer[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchWaiverPlayers();
  }, [league.id]);

  const fetchWaiverPlayers = async () => {
    try {
      setIsLoading(true);
      
      // Get current season and week
      const now = new Date();
      const currentSeason = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
      
      const { data: leagueData } = await supabase
        .from('connected_leagues')
        .select('current_week')
        .eq('id', league.id)
        .single();
      
      const currentWeek = leagueData?.current_week || 1;

      const { data, error } = await supabase
        .from('waiver_wire_players')
        .select('*')
        .eq('league_id', league.id)
        .eq('season', currentSeason)
        .eq('week', currentWeek)
        .order('percent_owned', { ascending: false })
        .limit(20);

      if (error) throw error;

      const mapped = (data || [])
        .filter(p => p && p.player_name && p.position) // Filter out null/invalid entries
        .map(p => ({
          id: p.id,
          name: p.player_name,
          position: p.position,
          team: p.team || 'FA',
          projected: 0, // Will be enhanced with projections later
        }));

      setWaiverPlayers(mapped);
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

  const analyzeWaivers = async () => {
    setIsAnalyzing(true);
    
    // Simulate AI analysis
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Mock AI recommendations
    const aiRecommendations = [
      {
        ...waiverPlayers[0],
        recommendation: {
          reasoning: "Nico Collins has elite target share (32%) and faces a weak secondary. Projected +4.8 pts over Drake London.",
          projectedGain: 4.8,
          dropPlayer: "Drake London"
        }
      }
    ];
    
    setRecommendations(aiRecommendations);
    setIsAnalyzing(false);
    
    toast({
      title: "Waiver Analysis Complete",
      description: `Found ${aiRecommendations.length} recommendation${aiRecommendations.length !== 1 ? 's' : ''}`,
    });
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
      <FetchProjections leagueId={league.id} />
      
      <Card className="border-2 border-accent/50 bg-gradient-to-br from-accent/5 to-primary/5">
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                AI Waiver Recommendations
              </CardTitle>
              <CardDescription>
                Get AI-powered add/drop suggestions from available free agents
              </CardDescription>
            </div>
            <Button 
              onClick={analyzeWaivers} 
              disabled={isAnalyzing}
              variant="glow"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Analyze Waivers
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {recommendations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>Click "Analyze Waivers" to get AI-powered add/drop recommendations</p>
            </div>
          ) : (
            <div className="space-y-4">
              {recommendations.map((player) => (
                <Card key={player.id} className="bg-background/50 border-green-500/30">
                  <CardContent className="p-4">
                    <div className="flex flex-col md:flex-row gap-4 items-start justify-between">
                      <div className="flex-1 space-y-3">
                        <div className="flex items-center gap-3">
                          <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
                            RECOMMENDED
                          </Badge>
                          <span className="font-semibold text-lg">{player.name}</span>
                          <Badge>{player.position}</Badge>
                          <span className="text-sm text-muted-foreground">{player.team}</span>
                        </div>
                        
                        {player.recommendation && (
                          <>
                            <p className="text-sm text-muted-foreground">
                              {player.recommendation.reasoning}
                            </p>
                            <div className="flex items-center gap-2 text-sm">
                              <span className="text-green-500 font-semibold">
                                +{player.recommendation.projectedGain} pts projected
                              </span>
                              <span className="text-muted-foreground">•</span>
                              <span className="text-muted-foreground">
                                Drop: {player.recommendation.dropPlayer}
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                      
                      <div className="flex gap-2">
                        <Button onClick={() => handleAddPlayer(player)} size="sm">
                          <Plus className="mr-2 h-4 w-4" />
                          Add
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Available Free Agents</CardTitle>
          <CardDescription>Top projected available players</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : waiverPlayers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No waiver players available. Try resyncing your league from the home page.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {waiverPlayers.filter(p => p && p.name).map(player => (
                <div key={player.id} className="space-y-2">
                <PlayerCard player={player} readOnly />
                <div className="flex gap-2">
                  <Button 
                    onClick={() => handleAddPlayer(player)} 
                    size="sm" 
                    className="flex-1"
                    variant="outline"
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Add
                  </Button>
                </div>
                </div>
              ))}
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
