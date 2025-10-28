import { useState } from "react";
import { Brain, TrendingUp, AlertCircle, Calendar, XCircle, CheckCircle } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { useStartSitAnalysis } from "@/hooks/useStartSitAnalysis";
import { getCurrentNFLWeek, formatLastUpdated } from "@/lib/nflWeekUtils";
import { useToast } from "@/hooks/use-toast";

export const StartSitAnalyzer = () => {
  const [player1, setPlayer1] = useState("");
  const [player2, setPlayer2] = useState("");
  const { analysis, loading, error, analyze } = useStartSitAnalysis();
  const { toast } = useToast();
  const nflWeek = getCurrentNFLWeek();

  const handleAnalyze = async () => {
    if (!player1.trim() || !player2.trim()) {
      toast({
        title: "Missing player names",
        description: "Please enter both player names to compare",
        variant: "destructive",
      });
      return;
    }

    await analyze(player1, player2);
  };

  return (
    <section id="start-sit" className="py-20 relative">
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Section Header */}
          <div className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/30 bg-primary/5">
              <Brain className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-primary">AI-Powered Analysis</span>
            </div>
            <h2 className="text-4xl font-bold">Start/Sit Analyzer</h2>
            <p className="text-muted-foreground text-lg">
              Week {nflWeek.week} Projections — {nflWeek.isOffseason ? 'Offseason' : 'Current Week Analysis'}
            </p>
            {!nflWeek.isOffseason && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>Excludes players on bye weeks or ruled out</span>
              </div>
            )}
          </div>

          {/* Analyzer Card */}
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm shadow-lg">
            <CardHeader>
              <CardTitle>Compare Players</CardTitle>
              <CardDescription>Enter two players to get an AI-powered recommendation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="player1">Player 1</Label>
                  <Input
                    id="player1"
                    placeholder="e.g., Justin Jefferson"
                    value={player1}
                    onChange={(e) => setPlayer1(e.target.value)}
                    className="bg-background border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="player2">Player 2</Label>
                  <Input
                    id="player2"
                    placeholder="e.g., Tyreek Hill"
                    value={player2}
                    onChange={(e) => setPlayer2(e.target.value)}
                    className="bg-background border-border"
                  />
                </div>
              </div>

              <Button 
                onClick={handleAnalyze} 
                disabled={!player1 || !player2 || loading || nflWeek.isOffseason}
                className="w-full"
                variant="glow"
                size="lg"
              >
                {loading ? (
                  <>
                    <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Brain className="h-5 w-5" />
                    Analyze Matchup
                  </>
                )}
              </Button>

              {/* Error Display */}
              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <XCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}

              {/* Analysis Results */}
              {analysis && (
                <div className="space-y-4 pt-4 border-t border-border">
                  {/* Recommendation Header */}
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                      analysis.confidence > 70 
                        ? 'bg-primary/20' 
                        : analysis.confidence > 40 
                        ? 'bg-accent/20' 
                        : 'bg-secondary/50'
                    }`}>
                      <TrendingUp className={`h-5 w-5 ${
                        analysis.confidence > 70 
                          ? 'text-primary' 
                          : analysis.confidence > 40 
                          ? 'text-accent' 
                          : 'text-muted-foreground'
                      }`} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold">{analysis.recommendation}</h4>
                        <Badge variant={analysis.confidence > 70 ? "default" : "secondary"}>
                          {analysis.confidence}% confident
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{analysis.reasoning}</p>
                    </div>
                  </div>

                  {/* Player Comparison Cards */}
                  <div className="grid md:grid-cols-2 gap-4">
                    {/* Player 1 */}
                    <div className={`p-4 rounded-lg border ${
                      analysis.player1.eligible && analysis.player1.projection && 
                      analysis.player2.eligible && analysis.player2.projection &&
                      analysis.player1.projection > analysis.player2.projection
                        ? 'bg-primary/5 border-primary/20'
                        : 'bg-secondary/50 border-border'
                    }`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className={`font-semibold ${
                          analysis.player1.eligible && analysis.player1.projection && 
                          analysis.player2.eligible && analysis.player2.projection &&
                          analysis.player1.projection > analysis.player2.projection
                            ? 'text-primary'
                            : ''
                        }`}>
                          {analysis.player1.name}
                        </div>
                        {!analysis.player1.eligible && (
                          <Badge variant="destructive" className="text-xs">
                            Ineligible
                          </Badge>
                        )}
                        {analysis.player1.eligible && analysis.player1.injury_status && (
                          <Badge variant="outline" className="text-xs">
                            {analysis.player1.injury_status}
                          </Badge>
                        )}
                      </div>
                      
                      {analysis.player1.eligible ? (
                        <>
                          <div className="text-xs text-muted-foreground mb-2">
                            {analysis.player1.team} • {analysis.player1.position}
                          </div>
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Projected:</span>
                              <span className="font-medium">{analysis.player1.projection?.toFixed(1)} pts</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Week:</span>
                              <span className="font-medium">{analysis.week}</span>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-start gap-2 text-sm text-muted-foreground">
                          <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                          <p>{analysis.player1.ineligibilityReason}</p>
                        </div>
                      )}
                    </div>

                    {/* Player 2 */}
                    <div className={`p-4 rounded-lg border ${
                      analysis.player2.eligible && analysis.player2.projection && 
                      analysis.player1.eligible && analysis.player1.projection &&
                      analysis.player2.projection > analysis.player1.projection
                        ? 'bg-primary/5 border-primary/20'
                        : 'bg-secondary/50 border-border'
                    }`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className={`font-semibold ${
                          analysis.player2.eligible && analysis.player2.projection && 
                          analysis.player1.eligible && analysis.player1.projection &&
                          analysis.player2.projection > analysis.player1.projection
                            ? 'text-primary'
                            : ''
                        }`}>
                          {analysis.player2.name}
                        </div>
                        {!analysis.player2.eligible && (
                          <Badge variant="destructive" className="text-xs">
                            Ineligible
                          </Badge>
                        )}
                        {analysis.player2.eligible && analysis.player2.injury_status && (
                          <Badge variant="outline" className="text-xs">
                            {analysis.player2.injury_status}
                          </Badge>
                        )}
                      </div>
                      
                      {analysis.player2.eligible ? (
                        <>
                          <div className="text-xs text-muted-foreground mb-2">
                            {analysis.player2.team} • {analysis.player2.position}
                          </div>
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Projected:</span>
                              <span className="font-medium">{analysis.player2.projection?.toFixed(1)} pts</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Week:</span>
                              <span className="font-medium">{analysis.week}</span>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-start gap-2 text-sm text-muted-foreground">
                          <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                          <p>{analysis.player2.ineligibilityReason}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Info Footer */}
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-accent/10 border border-accent/20">
                    <CheckCircle className="h-5 w-5 text-accent mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p>
                        Analysis based on Week {analysis.week} projections. 
                        Automatically excludes players on bye weeks or ruled out with injury.
                      </p>
                      <p className="text-xs">
                        Last updated: {formatLastUpdated(analysis.lastUpdated)}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
};
