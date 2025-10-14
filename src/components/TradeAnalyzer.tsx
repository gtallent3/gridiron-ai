import { ArrowRightLeft, TrendingUp, TrendingDown, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";

const mockTrade = {
  give: [
    {
      name: "Christian McCaffrey",
      position: "RB",
      team: "SF",
      value: 85,
      avgPoints: 22.4,
    },
    {
      name: "DK Metcalf",
      position: "WR",
      team: "SEA",
      value: 65,
      avgPoints: 14.2,
    },
  ],
  get: [
    {
      name: "Tyreek Hill",
      position: "WR",
      team: "MIA",
      value: 82,
      avgPoints: 18.7,
    },
    {
      name: "Joe Mixon",
      position: "RB",
      team: "HOU",
      value: 70,
      avgPoints: 16.5,
    },
  ],
};

export const TradeAnalyzer = () => {
  const giveTotal = mockTrade.give.reduce((sum, p) => sum + p.value, 0);
  const getTotal = mockTrade.get.reduce((sum, p) => sum + p.value, 0);
  const difference = getTotal - giveTotal;
  const isGoodTrade = difference >= 0;
  
  return (
    <section id="trade-analyzer" className="py-20 bg-gradient-to-b from-background to-secondary/20">
      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Section Header */}
          <div className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/30 bg-primary/5">
              <ArrowRightLeft className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-primary">Trade Evaluation</span>
            </div>
            <h2 className="text-4xl font-bold">Trade Analyzer</h2>
            <p className="text-muted-foreground text-lg">
              Evaluate trade fairness with AI-powered value analysis
            </p>
          </div>

          {/* Trade Comparison */}
          <div className="grid md:grid-cols-2 gap-6 relative">
            {/* Give Side */}
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <TrendingDown className="h-5 w-5 text-destructive" />
                    You Give
                  </CardTitle>
                  <Badge variant="outline" className="text-lg font-bold">
                    {giveTotal}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {mockTrade.give.map((player, index) => (
                  <div
                    key={index}
                    className="p-4 rounded-lg bg-secondary/30 border border-border/50 space-y-2"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-semibold text-lg">{player.name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="text-xs">
                            {player.position}
                          </Badge>
                          <span className="text-sm text-muted-foreground">{player.team}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-primary">{player.value}</div>
                        <div className="text-xs text-muted-foreground">Value</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-sm pt-2 border-t border-border/30">
                      <span className="text-muted-foreground">Avg Points/Week</span>
                      <span className="font-semibold">{player.avgPoints}</span>
                    </div>
                  </div>
                ))}
                <div className="pt-3 border-t border-border">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">Total Value</span>
                    <span className="text-2xl font-bold text-primary">{giveTotal}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Arrow Indicator */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 hidden md:block">
              <div className="bg-background border-2 border-primary rounded-full p-3 shadow-lg">
                <ArrowRightLeft className="h-6 w-6 text-primary" />
              </div>
            </div>

            {/* Get Side */}
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    You Get
                  </CardTitle>
                  <Badge variant="outline" className="text-lg font-bold">
                    {getTotal}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {mockTrade.get.map((player, index) => (
                  <div
                    key={index}
                    className="p-4 rounded-lg bg-secondary/30 border border-border/50 space-y-2"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-semibold text-lg">{player.name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="text-xs">
                            {player.position}
                          </Badge>
                          <span className="text-sm text-muted-foreground">{player.team}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-primary">{player.value}</div>
                        <div className="text-xs text-muted-foreground">Value</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-sm pt-2 border-t border-border/30">
                      <span className="text-muted-foreground">Avg Points/Week</span>
                      <span className="font-semibold">{player.avgPoints}</span>
                    </div>
                  </div>
                ))}
                <div className="pt-3 border-t border-border">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">Total Value</span>
                    <span className="text-2xl font-bold text-primary">{getTotal}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Trade Verdict */}
          <Card className={`border-2 ${isGoodTrade ? 'border-primary bg-primary/5' : 'border-destructive/50 bg-destructive/5'}`}>
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                {isGoodTrade ? (
                  <CheckCircle2 className="h-8 w-8 text-primary flex-shrink-0" />
                ) : (
                  <AlertCircle className="h-8 w-8 text-destructive flex-shrink-0" />
                )}
                <div className="flex-1">
                  <h3 className="text-xl font-bold mb-2">
                    {isGoodTrade ? 'Accept This Trade' : 'Consider Rejecting'}
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    {isGoodTrade 
                      ? `This trade gains you ${difference} points in total value. You're receiving stronger players based on season projections and consistency metrics.`
                      : `This trade would cost you ${Math.abs(difference)} points in total value. You're giving up more valuable players than you're receiving.`
                    }
                  </p>
                  <div className="flex items-center gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Value Difference: </span>
                      <span className={`font-bold ${difference >= 0 ? 'text-primary' : 'text-destructive'}`}>
                        {difference >= 0 ? '+' : ''}{difference}
                      </span>
                    </div>
                    <div className="h-4 w-px bg-border" />
                    <div>
                      <span className="text-muted-foreground">Trade Grade: </span>
                      <span className="font-bold">
                        {Math.abs(difference) < 5 ? 'Fair' : isGoodTrade ? 'Win' : 'Loss'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
};
