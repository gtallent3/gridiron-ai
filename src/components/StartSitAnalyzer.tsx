import { useState } from "react";
import { Brain, TrendingUp, AlertCircle } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export const StartSitAnalyzer = () => {
  const [player1, setPlayer1] = useState("");
  const [player2, setPlayer2] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  const handleAnalyze = () => {
    setAnalyzing(true);
    setTimeout(() => setAnalyzing(false), 2000);
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
              Get instant AI recommendations based on matchups, trends, and projections
            </p>
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
                disabled={!player1 || !player2 || analyzing}
                className="w-full"
                variant="glow"
                size="lg"
              >
                {analyzing ? (
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

              {/* Mock Results */}
              {analyzing === false && player1 && player2 && (
                <div className="space-y-4 pt-4 border-t border-border">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                      <TrendingUp className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold">Recommendation: Start {player1}</h4>
                      <p className="text-sm text-muted-foreground">
                        Better matchup against weaker defense, higher projected points
                      </p>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                      <div className="font-semibold text-primary mb-2">{player1}</div>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Projected Points:</span>
                          <span className="font-medium">18.5</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Matchup Grade:</span>
                          <span className="font-medium text-primary">A-</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-4 rounded-lg bg-secondary/50 border border-border">
                      <div className="font-semibold mb-2">{player2}</div>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Projected Points:</span>
                          <span className="font-medium">15.8</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Matchup Grade:</span>
                          <span className="font-medium">B</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-2 p-3 rounded-lg bg-accent/10 border border-accent/20">
                    <AlertCircle className="h-5 w-5 text-accent mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-muted-foreground">
                      This analysis considers opponent defense ranking, recent performance trends, 
                      injury reports, and weather conditions.
                    </p>
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
