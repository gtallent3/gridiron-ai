import { Trophy, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useNavigate } from "react-router-dom";
import { Button } from "./ui/button";

// Example data for the snapshot
const exampleStrengths = [
  {
    team: "Championship Contenders",
    QB: { rank: 2, zScore: 1.2, pss: 85.3 },
    RB: { rank: 1, zScore: 1.8, pss: 92.1 },
    WR: { rank: 3, zScore: 0.7, pss: 78.9 },
    TE: { rank: 4, zScore: -0.2, pss: 68.4 },
  },
  {
    team: "Playoff Push",
    QB: { rank: 5, zScore: -0.4, pss: 65.2 },
    RB: { rank: 3, zScore: 0.9, pss: 82.7 },
    WR: { rank: 1, zScore: 2.1, pss: 95.8 },
    TE: { rank: 2, zScore: 1.1, pss: 81.5 },
  },
  {
    team: "Rebuilding Squad",
    QB: { rank: 1, zScore: 1.5, pss: 88.6 },
    RB: { rank: 6, zScore: -1.2, pss: 58.3 },
    WR: { rank: 5, zScore: -0.3, pss: 70.1 },
    TE: { rank: 3, zScore: 0.6, pss: 75.9 },
  },
  {
    team: "My Team",
    QB: { rank: 3, zScore: 0.8, pss: 79.4 },
    RB: { rank: 2, zScore: 1.3, pss: 86.2 },
    WR: { rank: 2, zScore: 1.4, pss: 87.5 },
    TE: { rank: 1, zScore: 1.7, pss: 89.3 },
  },
];

const positions = ["QB", "RB", "WR", "TE"];

export const PositionalRankingsSnapshot = () => {
  const navigate = useNavigate();

  const getRankColor = (zScore: number) => {
    if (zScore > 0.5) return "bg-primary/20 text-primary";
    if (zScore < -0.5) return "bg-destructive/20 text-destructive";
    return "bg-secondary text-secondary-foreground";
  };

  const getBarWidth = (zScore: number) => {
    // Map z-score to 0-100% width (clamp between -2 and +2)
    const clamped = Math.max(-2, Math.min(2, zScore));
    return ((clamped + 2) / 4) * 100;
  };

  const getBarColor = (zScore: number) => {
    if (zScore > 0.5) return "bg-primary";
    if (zScore < -0.5) return "bg-destructive";
    return "bg-muted-foreground";
  };

  return (
    <section id="positional-rankings" className="py-20 bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Section Header */}
          <div className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/30 bg-primary/5">
              <Trophy className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-primary">League Insights</span>
            </div>
            <h2 className="text-4xl font-bold">Positional Rankings</h2>
            <p className="text-muted-foreground text-lg">
              See how teams stack up by position across your league
            </p>
          </div>

          {/* Rankings Card */}
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Example League Rankings
              </CardTitle>
              <CardDescription>
                Connect your league to see real-time positional strength analysis
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[180px]">Team</TableHead>
                      {positions.map(pos => (
                        <TableHead key={pos} className="text-center min-w-[100px]">
                          {pos}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exampleStrengths.map((team) => (
                      <TableRow key={team.team} className={team.team === "My Team" ? "bg-primary/5" : ""}>
                        <TableCell className="font-medium">
                          {team.team}
                          {team.team === "My Team" && (
                            <Badge variant="outline" className="ml-2 text-xs">
                              You
                            </Badge>
                          )}
                        </TableCell>
                        {positions.map(pos => {
                          const strength = team[pos as keyof typeof team] as { rank: number; zScore: number; pss: number };
                          
                          return (
                            <TableCell key={pos} className="text-center">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex flex-col items-center gap-1">
                                      <Badge
                                        variant="outline"
                                        className={getRankColor(strength.zScore)}
                                      >
                                        #{strength.rank}
                                      </Badge>
                                      <div className="w-full bg-secondary rounded-full h-1.5">
                                        <div
                                          className={`h-1.5 rounded-full transition-all ${getBarColor(strength.zScore)}`}
                                          style={{ width: `${getBarWidth(strength.zScore)}%` }}
                                        />
                                      </div>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <div className="text-sm space-y-1">
                                      <p className="font-semibold">{pos} Strength</p>
                                      <p>PSS: {strength.pss.toFixed(1)}</p>
                                      <p>Z-Score: {strength.zScore.toFixed(2)}</p>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Call to Action */}
              <div className="mt-6 p-4 rounded-lg bg-accent/10 border border-accent/20">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="text-center sm:text-left">
                    <p className="font-medium">Want to see your league's rankings?</p>
                    <p className="text-sm text-muted-foreground">
                      Connect your league to unlock detailed positional analysis
                    </p>
                  </div>
                  <Button onClick={() => navigate('/connect-league')} variant="default">
                    Connect League
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