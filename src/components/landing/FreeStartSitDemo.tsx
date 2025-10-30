import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lock, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";

export const FreeStartSitDemo = () => {
  const [player1, setPlayer1] = useState("");
  const [player2, setPlayer2] = useState("");
  const [showResults, setShowResults] = useState(false);
  const navigate = useNavigate();

  const handleAnalyze = () => {
    if (player1 && player2) {
      setShowResults(true);
    }
  };

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    element?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section id="free-start-sit" className="py-20 bg-muted/30 scroll-mt-20">
      <div className="container mx-auto px-4">
        <div className="max-w-3xl mx-auto space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <h2 className="text-4xl font-bold">Try the Start/Sit Demo</h2>
            <p className="text-muted-foreground text-lg">
              No account needed — Compare any two players instantly
            </p>
          </div>

          {/* Demo Card */}
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Basic Player Comparison
              </CardTitle>
              <CardDescription>
                Enter two player names to see a quick comparison
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="player1">Player 1</Label>
                  <Input
                    id="player1"
                    placeholder="e.g., Patrick Mahomes"
                    value={player1}
                    onChange={(e) => setPlayer1(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="player2">Player 2</Label>
                  <Input
                    id="player2"
                    placeholder="e.g., Josh Allen"
                    value={player2}
                    onChange={(e) => setPlayer2(e.target.value)}
                  />
                </div>
              </div>

              <Button 
                onClick={handleAnalyze} 
                className="w-full"
                disabled={!player1 || !player2}
              >
                Analyze Players
              </Button>

              {showResults && (
                <Alert className="border-primary/50 bg-primary/5">
                  <AlertDescription className="text-center">
                    <p className="font-medium mb-2">
                      Demo results would appear here with basic projections
                    </p>
                    <p className="text-sm text-muted-foreground">
                      This is a simplified demo. Sign up for full league-based analysis with your actual scoring settings.
                    </p>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Upgrade Banner */}
          <Card className="border-accent/50 bg-gradient-to-r from-primary/5 to-accent/5">
            <CardContent className="pt-6">
              <div className="text-center space-y-4">
                <div className="flex items-center justify-center gap-2">
                  <Lock className="h-5 w-5 text-primary" />
                  <h3 className="text-xl font-semibold">Want Full League-Based Analysis?</h3>
                </div>
                <p className="text-muted-foreground">
                  Sync your team and get personalized insights based on your actual roster and scoring settings. 
                  <strong className="text-foreground"> Get 3 free tokens to start!</strong>
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                  <Button onClick={() => navigate('/auth')}>
                    Sync My League
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => scrollToSection('comparison')}
                  >
                    Explore All Features
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
};
