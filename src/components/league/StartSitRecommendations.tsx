import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ArrowLeftRight, TrendingUp, Loader2, Coins } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTokens } from "@/hooks/useTokens";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

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
  const navigate = useNavigate();
  const { hasUnlimited, checkBalance, deductToken } = useTokens();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);

    const analyzeLineup = async () => {
    // Check token balance
    if (!hasUnlimited && !checkBalance(1)) {
      toast({
        title: "Insufficient Tokens",
        description: "You need 1 token for Start/Sit analysis",
        variant: "destructive",
      });
      setTimeout(() => navigate("/shop"), 2000);
      return;
    }

    setIsAnalyzing(true);
    
    try {
      // Deduct token BEFORE analysis for immediate UI update
      const deductResult = await deductToken("start_sit", "AI lineup optimization analysis");
      if (!deductResult.success) {
        setIsAnalyzing(false);
        return;
      }

      const now = new Date();
      const season = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
      const week = Math.max(1, Math.min(18, Math.ceil((now.getTime() - new Date(season, 8, 5).getTime()) / (7 * 24 * 60 * 60 * 1000))));

      // Call AI-powered lineup analysis
      const { data, error } = await supabase.functions.invoke('analyze-lineup', {
        body: {
          starters,
          bench,
          week,
          season,
        }
      });

      if (error) {
        throw error;
      }

      if (!data?.recommendations) {
        throw new Error('No recommendations returned');
      }

      setRecommendations(data.recommendations);
      
      toast({
        title: "Analysis Complete",
        description: data.recommendations.length > 0 
          ? `Found ${data.recommendations.length} optimization${data.recommendations.length !== 1 ? 's' : ''}`
          : "Your lineup looks optimal!",
      });
    } catch (error: any) {
      console.error('Analysis error:', error);
      toast({
        title: "Analysis Failed",
        description: error.message || "Failed to analyze lineup. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
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
        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <Sparkles className="h-5 w-5 text-primary" />
              AI Start/Sit Recommendations
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              Optimize your lineup with AI-powered suggestions
              <Badge variant="outline" className="text-xs flex items-center gap-1">
                <Coins className="h-3 w-3" />
                1 token
              </Badge>
            </div>
          </div>
          <Button 
            onClick={analyzeLineup} 
            disabled={isAnalyzing}
            variant="glow"
            className="w-full sm:w-auto touch-target"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="ml-2">Analyzing...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                <span className="ml-2">Analyze Lineup</span>
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
