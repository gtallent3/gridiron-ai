import { useState, useEffect } from "react";
import { Brain, TrendingUp, AlertCircle, Calendar, XCircle, CheckCircle } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { useStartSitAnalysis } from "@/hooks/useStartSitAnalysis";
import { getCurrentNFLWeek, formatLastUpdated } from "@/lib/nflWeekUtils";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export const StartSitAnalyzer = () => {
  const [player1, setPlayer1] = useState("");
  const [player2, setPlayer2] = useState("");
  const [player1Suggestions, setPlayer1Suggestions] = useState<Array<{ player_name: string; team: string; position: string }>>([]);
  const [player2Suggestions, setPlayer2Suggestions] = useState<Array<{ player_name: string; team: string; position: string }>>([]);
  const [showPlayer1Dropdown, setShowPlayer1Dropdown] = useState(false);
  const [showPlayer2Dropdown, setShowPlayer2Dropdown] = useState(false);
  const { analysis, loading, error, analyze } = useStartSitAnalysis();
  const { toast } = useToast();
  const nflWeek = getCurrentNFLWeek();

  // Fetch player suggestions for player 1
  useEffect(() => {
    if (player1.length < 2) {
      setPlayer1Suggestions([]);
      setShowPlayer1Dropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from('sleeper_projections')
          .select('player_name, team, position')
          .ilike('player_name', `%${player1}%`)
          .eq('week', nflWeek.week)
          .eq('season', nflWeek.season)
          .order('player_name')
          .limit(20);

        if (error) {
          console.error('Error fetching players:', error);
          return;
        }

        if (data) {
          // Remove duplicates based on player_name
          const uniquePlayers = Array.from(
            new Map(data.map(p => [p.player_name, p])).values()
          ).slice(0, 10);
          
          setPlayer1Suggestions(uniquePlayers);
          setShowPlayer1Dropdown(uniquePlayers.length > 0);
        }
      } catch (err) {
        console.error('Failed to fetch players:', err);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [player1, nflWeek.week, nflWeek.season]);

  // Fetch player suggestions for player 2
  useEffect(() => {
    if (player2.length < 2) {
      setPlayer2Suggestions([]);
      setShowPlayer2Dropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from('sleeper_projections')
          .select('player_name, team, position')
          .ilike('player_name', `%${player2}%`)
          .eq('week', nflWeek.week)
          .eq('season', nflWeek.season)
          .order('player_name')
          .limit(20);

        if (error) {
          console.error('Error fetching players:', error);
          return;
        }

        if (data) {
          // Remove duplicates based on player_name
          const uniquePlayers = Array.from(
            new Map(data.map(p => [p.player_name, p])).values()
          ).slice(0, 10);
          
          setPlayer2Suggestions(uniquePlayers);
          setShowPlayer2Dropdown(uniquePlayers.length > 0);
        }
      } catch (err) {
        console.error('Failed to fetch players:', err);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [player2, nflWeek.week, nflWeek.season]);

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

  const selectPlayer1 = (playerName: string) => {
    setPlayer1(playerName);
    setShowPlayer1Dropdown(false);
  };

  const selectPlayer2 = (playerName: string) => {
    setPlayer2(playerName);
    setShowPlayer2Dropdown(false);
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
                <div className="space-y-2 relative">
                  <Label htmlFor="player1">Player 1</Label>
                  <Input
                    id="player1"
                    placeholder="Start typing player name..."
                    value={player1}
                    onChange={(e) => setPlayer1(e.target.value)}
                    onFocus={() => player1.length >= 2 && setShowPlayer1Dropdown(true)}
                    onBlur={() => setTimeout(() => setShowPlayer1Dropdown(false), 200)}
                    className="bg-background border-border"
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
                    className="bg-background border-border"
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
