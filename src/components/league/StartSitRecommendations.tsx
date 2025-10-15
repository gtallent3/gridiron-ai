import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ArrowLeftRight, TrendingUp, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Player = {
  id: string;
  name: string;
  position: string;
  team: string;
  projected: number;
};

type StartSitRecommendationsProps = {
  starters: Player[];
  bench: Player[];
  onSubstitution: (starterId: string, benchId: string) => void;
};

type Recommendation = {
  benchPlayer: Player;
  starterPlayer: Player;
  reasoning: string;
  projectedGain: number;
  winProbabilityChange: number;
};

export function StartSitRecommendations({ starters, bench, onSubstitution }: StartSitRecommendationsProps) {
  const { toast } = useToast();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);

  const analyzeLineup = async () => {
    setIsAnalyzing(true);
    
    // Simulate AI analysis
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Mock recommendations - will be replaced with real AI
    const mockRecommendations: Recommendation[] = [
      {
        benchPlayer: bench.find(p => p.name === "Jaylen Waddle")!,
        starterPlayer: starters.find(p => p.position === "WR" && p.name !== "Tyreek Hill" && p.name !== "CeeDee Lamb")!,
        reasoning: "Waddle has a more favorable matchup against a weak secondary. Expected target share of 28% with Tyreek Hill drawing coverage.",
        projectedGain: 2.2,
        winProbabilityChange: 3.2,
      },
    ].filter(r => r.benchPlayer && r.starterPlayer);

    setRecommendations(mockRecommendations);
    setIsAnalyzing(false);
    
    toast({
      title: "Analysis Complete",
      description: `Found ${mockRecommendations.length} optimization${mockRecommendations.length !== 1 ? 's' : ''}`,
    });
  };

  const applyRecommendation = (rec: Recommendation) => {
    onSubstitution(rec.starterPlayer.id, rec.benchPlayer.id);
    
    toast({
      title: "Lineup Updated",
      description: `${rec.benchPlayer.name} moved to starting lineup`,
    });
    
    // Remove applied recommendation
    setRecommendations(prev => prev.filter(r => r !== rec));
  };

  return (
    <Card className="border-2 border-accent/50 bg-gradient-to-br from-accent/5 to-primary/5">
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI Start/Sit Recommendations
            </CardTitle>
            <CardDescription>
              Optimize your lineup with AI-powered suggestions
            </CardDescription>
          </div>
          <Button 
            onClick={analyzeLineup} 
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
                Analyze Lineup
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {recommendations.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>Click "Analyze Lineup" to get AI-powered start/sit recommendations</p>
          </div>
        ) : (
          <div className="space-y-4">
            {recommendations.map((rec, idx) => (
              <Card key={idx} className="bg-background/50">
                <CardContent className="p-4">
                  <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
                            START
                          </Badge>
                          <span className="font-semibold">{rec.benchPlayer.name}</span>
                          <span className="text-sm text-muted-foreground">({rec.benchPlayer.position})</span>
                        </div>
                        
                        <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
                        
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">
                            SIT
                          </Badge>
                          <span className="font-semibold">{rec.starterPlayer.name}</span>
                          <span className="text-sm text-muted-foreground">({rec.starterPlayer.position})</span>
                        </div>
                      </div>
                      
                      <p className="text-sm text-muted-foreground">{rec.reasoning}</p>
                      
                      <div className="flex gap-4 text-sm">
                        <div className="flex items-center gap-1 text-green-500">
                          <TrendingUp className="h-4 w-4" />
                          <span className="font-semibold">+{rec.projectedGain} pts</span>
                        </div>
                        <div className="flex items-center gap-1 text-green-500">
                          <TrendingUp className="h-4 w-4" />
                          <span className="font-semibold">+{rec.winProbabilityChange}% win chance</span>
                        </div>
                      </div>
                    </div>
                    
                    <Button 
                      onClick={() => applyRecommendation(rec)}
                      className="shrink-0"
                    >
                      Apply Change
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
