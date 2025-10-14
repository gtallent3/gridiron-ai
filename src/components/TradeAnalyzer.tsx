import { BarChart3, Shield, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

const mockPlayers = [
  {
    name: "Christian McCaffrey",
    position: "RB",
    team: "SF",
    points: 22.4,
    consistency: 92,
    matchup: "vs ARI",
    grade: "A+",
  },
  {
    name: "Tyreek Hill",
    position: "WR",
    team: "MIA",
    points: 18.7,
    consistency: 85,
    matchup: "vs NYJ",
    grade: "A-",
  },
];

export const TradeAnalyzer = () => {
  return (
    <section id="trade-analyzer" className="py-20 bg-gradient-to-b from-background to-secondary/20">
      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Section Header */}
          <div className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/30 bg-primary/5">
              <BarChart3 className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-primary">Side-by-Side Analysis</span>
            </div>
            <h2 className="text-4xl font-bold">Trade Analyzer</h2>
            <p className="text-muted-foreground text-lg">
              Analyze trade values and player projections side-by-side
            </p>
          </div>

          {/* Comparison Grid */}
          <div className="grid md:grid-cols-2 gap-6">
            {mockPlayers.map((player, index) => (
              <Card
                key={index}
                className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_30px_hsl(var(--glow-primary)/0.2)]"
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-2xl">{player.name}</CardTitle>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="px-2 py-1 rounded bg-primary/20 text-primary text-xs font-semibold">
                          {player.position}
                        </span>
                        <span className="text-sm text-muted-foreground">{player.team}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-3xl font-bold text-primary">{player.points}</div>
                      <div className="text-xs text-muted-foreground">Projected Pts</div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Matchup */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">Matchup</span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold">{player.matchup}</div>
                      <div className="text-xs text-primary font-semibold">Grade: {player.grade}</div>
                    </div>
                  </div>

                  {/* Consistency */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Activity className="h-4 w-4 text-accent" />
                        <span className="font-medium">Consistency Score</span>
                      </div>
                      <span className="font-semibold">{player.consistency}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-accent to-primary rounded-full transition-all duration-500"
                        style={{ width: `${player.consistency}%` }}
                      />
                    </div>
                  </div>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-3 gap-3 pt-2">
                    <div className="text-center p-2 rounded bg-background/50">
                      <div className="text-lg font-bold text-primary">15.2</div>
                      <div className="text-xs text-muted-foreground">Avg PPG</div>
                    </div>
                    <div className="text-center p-2 rounded bg-background/50">
                      <div className="text-lg font-bold text-primary">8</div>
                      <div className="text-xs text-muted-foreground">Games</div>
                    </div>
                    <div className="text-center p-2 rounded bg-background/50">
                      <div className="text-lg font-bold text-primary">23.8</div>
                      <div className="text-xs text-muted-foreground">Ceiling</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
