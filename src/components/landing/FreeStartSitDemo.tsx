import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lock, Sparkles, TrendingUp, AlertCircle, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useStartSitAnalysis } from "@/hooks/useStartSitAnalysis";

export const FreeStartSitDemo = () => {
  const [player1, setPlayer1] = useState("");
  const [player2, setPlayer2] = useState("");
  const [player1Suggestions, setPlayer1Suggestions] = useState<Array<{ player_name: string; team: string; position: string }>>([]);
  const [player2Suggestions, setPlayer2Suggestions] = useState<Array<{ player_name: string; team: string; position: string }>>([]);
  const [showPlayer1Dropdown, setShowPlayer1Dropdown] = useState(false);
  const [showPlayer2Dropdown, setShowPlayer2Dropdown] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const navigate = useNavigate();
  const { analysis, loading, error, analyze } = useStartSitAnalysis();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsLoggedIn(!!session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsLoggedIn(!!session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch player suggestions for player 1
  useEffect(() => {
    if (player1.length < 2) {
      setPlayer1Suggestions([]);
      setShowPlayer1Dropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('player_valuations')
        .select('player_name, team, position')
        .ilike('player_name', `%${player1}%`)
        .order('player_name')
        .limit(10);

      if (data) {
        // Remove duplicates
        const unique = data.reduce((acc: typeof data, current) => {
          const exists = acc.find(p => p.player_name === current.player_name);
          if (!exists) acc.push(current);
          return acc;
        }, []);
        setPlayer1Suggestions(unique);
        setShowPlayer1Dropdown(true);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [player1]);

  // Fetch player suggestions for player 2
  useEffect(() => {
    if (player2.length < 2) {
      setPlayer2Suggestions([]);
      setShowPlayer2Dropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('player_valuations')
        .select('player_name, team, position')
        .ilike('player_name', `%${player2}%`)
        .order('player_name')
        .limit(10);

      if (data) {
        // Remove duplicates
        const unique = data.reduce((acc: typeof data, current) => {
          const exists = acc.find(p => p.player_name === current.player_name);
          if (!exists) acc.push(current);
          return acc;
        }, []);
        setPlayer2Suggestions(unique);
        setShowPlayer2Dropdown(true);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [player2]);

  const handleAnalyze = async () => {
    if (player1 && player2) {
      await analyze(player1, player2);
    }
  };

  const selectPlayer1 = (playerName: string) => {
    setPlayer1(playerName);
    setShowPlayer1Dropdown(false);
  };

  const selectPlayer2 = (playerName: string) => {
    setPlayer2(playerName);
    setShowPlayer2Dropdown(false);
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
                <div className="space-y-2 relative">
                  <Label htmlFor="player1">Player 1</Label>
                  <Input
                    id="player1"
                    placeholder="Start typing player name..."
                    value={player1}
                    onChange={(e) => setPlayer1(e.target.value)}
                    onFocus={() => player1.length >= 2 && setShowPlayer1Dropdown(true)}
                    onBlur={() => setTimeout(() => setShowPlayer1Dropdown(false), 200)}
                  />
                  {showPlayer1Dropdown && player1Suggestions.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-background border rounded-lg shadow-lg max-h-[300px] overflow-y-auto">
                      {player1Suggestions.map((player, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => selectPlayer1(player.player_name)}
                          className="w-full px-4 py-3 text-left hover:bg-accent transition-colors border-b last:border-b-0"
                        >
                          <div className="font-semibold">{player.player_name}</div>
                          <div className="text-xs text-muted-foreground">
                            {player.team} • {player.position}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-2 relative">
                  <Label htmlFor="player2">Player 2</Label>
                  <Input
                    id="player2"
                    placeholder="Start typing player name..."
                    value={player2}
                    onChange={(e) => setPlayer2(e.target.value)}
                    onFocus={() => player2.length >= 2 && setShowPlayer2Dropdown(true)}
                    onBlur={() => setTimeout(() => setShowPlayer2Dropdown(false), 200)}
                  />
                  {showPlayer2Dropdown && player2Suggestions.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-background border rounded-lg shadow-lg max-h-[300px] overflow-y-auto">
                      {player2Suggestions.map((player, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => selectPlayer2(player.player_name)}
                          className="w-full px-4 py-3 text-left hover:bg-accent transition-colors border-b last:border-b-0"
                        >
                          <div className="font-semibold">{player.player_name}</div>
                          <div className="text-xs text-muted-foreground">
                            {player.team} • {player.position}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <Button 
                onClick={handleAnalyze} 
                className="w-full"
                disabled={!player1 || !player2 || loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  'Analyze Players'
                )}
              </Button>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {analysis && (
                <div className="space-y-4 p-6 rounded-lg border bg-card">
                  {/* Recommendation Header - Always Visible */}
                  <div className="text-center space-y-2">
                    <div className="flex items-center justify-center gap-2">
                      <TrendingUp className="h-5 w-5 text-primary" />
                      <h3 className="text-xl font-semibold">Recommendation</h3>
                    </div>
                    <p className="text-2xl font-bold text-primary">
                      {analysis.recommendation}
                    </p>
                  </div>

                  {/* Blurred Section for Unsigned Users */}
                  <div className="relative">
                    <div className={`space-y-4 ${
                      !isLoggedIn ? 'blur-sm' : ''
                    } transition-all duration-300`}>
                      {/* Confidence Message */}
                      <p className="text-sm text-center text-muted-foreground">
                        {analysis.confidence >= 80 ? 
                          `Start ${analysis.recommendation} with confidence` : 
                          analysis.confidence >= 60 ?
                          `${analysis.recommendation} has the edge` :
                          `Toss-up — ${analysis.recommendation} edges out slightly`
                        }
                      </p>

                      {/* Player Comparison */}
                      <div className="grid sm:grid-cols-2 gap-4">
                        {/* Player 1 */}
                        <div className={`p-4 rounded-lg border ${
                          analysis.player1.name === analysis.recommendation 
                            ? 'border-primary bg-primary/5' 
                            : 'border-border'
                        }`}>
                          <h4 className="font-semibold mb-2">{analysis.player1.name}</h4>
                          {analysis.player1.team && (
                            <p className="text-sm text-muted-foreground">{analysis.player1.team} • {analysis.player1.position}</p>
                          )}
                          <p className="text-2xl font-bold mt-2">
                            {analysis.player1.projection?.toFixed(1)} pts
                          </p>
                          {analysis.player1.injury_status && (
                            <p className="text-xs text-destructive mt-1">
                              {analysis.player1.injury_status}
                            </p>
                          )}
                          {!analysis.player1.eligible && (
                            <p className="text-xs text-destructive mt-1">
                              {analysis.player1.ineligibilityReason}
                            </p>
                          )}
                        </div>

                        {/* Player 2 */}
                        <div className={`p-4 rounded-lg border ${
                          analysis.player2.name === analysis.recommendation 
                            ? 'border-primary bg-primary/5' 
                            : 'border-border'
                        }`}>
                          <h4 className="font-semibold mb-2">{analysis.player2.name}</h4>
                          {analysis.player2.team && (
                            <p className="text-sm text-muted-foreground">{analysis.player2.team} • {analysis.player2.position}</p>
                          )}
                          <p className="text-2xl font-bold mt-2">
                            {analysis.player2.projection?.toFixed(1)} pts
                          </p>
                          {analysis.player2.injury_status && (
                            <p className="text-xs text-destructive mt-1">
                              {analysis.player2.injury_status}
                            </p>
                          )}
                          {!analysis.player2.eligible && (
                            <p className="text-xs text-destructive mt-1">
                              {analysis.player2.ineligibilityReason}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Reasoning */}
                      <div className="p-4 rounded-lg bg-muted/50">
                        <h4 className="font-semibold mb-2">Analysis</h4>
                        <p className="text-sm text-muted-foreground">{analysis.reasoning}</p>
                      </div>

                      {/* Week Info */}
                      <p className="text-xs text-center text-muted-foreground">
                        Week {analysis.week} • Season {analysis.season}
                      </p>
                    </div>

                    {/* Blur Overlay for Unsigned Users */}
                    {!isLoggedIn && (
                      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-t from-background/95 via-background/80 to-transparent rounded-lg">
                        <div className="text-center space-y-4 p-6 animate-in fade-in zoom-in duration-500">
                          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-2">
                            <Lock className="h-8 w-8 text-primary animate-pulse" />
                          </div>
                          <h3 className="text-2xl font-bold">Want to see the details?</h3>
                          <p className="text-muted-foreground max-w-md">
                            Sign up free to unlock projections, reasoning, and weekly AI insights
                          </p>
                          <Button 
                            size="lg"
                            onClick={() => navigate('/auth')}
                            className="mt-4"
                          >
                            Unlock Full Analysis →
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
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
