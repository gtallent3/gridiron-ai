import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, XCircle, AlertCircle, TrendingUp, TrendingDown } from "lucide-react";

type TradeResult = {
  verdict: "accept" | "decline" | "close" | "balanced";
  grade: string;
  confidence: number;
  ros_points_delta: number;
  next_3_weeks_delta: number;
  best_player_bonus_applied: boolean;
  summary: string;
  key_factors: string[];
  positional_impacts: {
    position: string;
    impact: string;
    delta: number;
  }[];
  risk_profile?: string;
  must_win_mode?: boolean;
  // Legacy support
  pointsChange?: number;
  positionalAnalysis?: {
    position: string;
    before: number;
    after: number;
    impact: string;
  }[];
  weeklyProjections?: {
    week: number;
    before: number;
    after: number;
  }[];
};

type TradeEvaluationProps = {
  result: TradeResult;
};

export function TradeEvaluation({ result }: TradeEvaluationProps) {
  const pointsChange = result.ros_points_delta ?? result.pointsChange ?? 0;
  const positionalData = result.positional_impacts || result.positionalAnalysis || [];
  
  const getVerdictIcon = () => {
    switch (result.verdict) {
      case "accept":
        return <CheckCircle className="h-8 w-8 text-green-500" />;
      case "decline":
        return <XCircle className="h-8 w-8 text-red-500" />;
      case "close":
      case "balanced":
        return <AlertCircle className="h-8 w-8 text-yellow-500" />;
    }
  };

  const getVerdictColor = () => {
    switch (result.verdict) {
      case "accept":
        return "text-green-500 border-green-500/50 bg-green-500/10";
      case "decline":
        return "text-red-500 border-red-500/50 bg-red-500/10";
      case "close":
      case "balanced":
        return "text-yellow-500 border-yellow-500/50 bg-yellow-500/10";
    }
  };

  const getGradeColor = () => {
    const grades = ['A', 'B', 'C', 'D', 'F'];
    const index = grades.indexOf(result.grade);
    if (index <= 1) return "text-green-500";
    if (index === 2) return "text-yellow-500";
    return "text-red-500";
  };

  return (
    <div className="space-y-6">
      {/* Overall Verdict */}
      <Card className={`border-2 ${getVerdictColor()}`}>
        <CardHeader>
          <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {getVerdictIcon()}
                <div>
                  <CardTitle className="text-2xl">
                    {result.verdict === "accept" && "Accept Trade"}
                    {result.verdict === "decline" && "Decline Trade"}
                    {(result.verdict === "close" || result.verdict === "balanced") && "Balanced Trade"}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {result.confidence}% AI confidence
                    {result.best_player_bonus_applied && " • Best Player Bonus Applied ⭐"}
                  </p>
                </div>
              </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Trade Grade</p>
              <p className={`text-5xl font-bold ${getGradeColor()}`}>
                {result.grade}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-background/50 rounded-lg">
            <span className="text-sm font-medium">Rest-of-Season Points Impact</span>
            <div className="flex items-center gap-2">
              {pointsChange >= 0 ? (
                <TrendingUp className="h-5 w-5 text-green-500" />
              ) : (
                <TrendingDown className="h-5 w-5 text-red-500" />
              )}
              <span className={`text-2xl font-bold ${pointsChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {pointsChange >= 0 ? '+' : ''}{pointsChange.toFixed(1)}
              </span>
            </div>
          </div>

          {result.next_3_weeks_delta !== undefined && (
            <div className="flex items-center justify-between p-4 bg-background/50 rounded-lg">
              <span className="text-sm font-medium">Next 3 Weeks Impact</span>
              <div className="flex items-center gap-2">
                {result.next_3_weeks_delta >= 0 ? (
                  <TrendingUp className="h-5 w-5 text-green-500" />
                ) : (
                  <TrendingDown className="h-5 w-5 text-red-500" />
                )}
                <span className={`text-2xl font-bold ${result.next_3_weeks_delta >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {result.next_3_weeks_delta >= 0 ? '+' : ''}{result.next_3_weeks_delta.toFixed(1)}
                </span>
              </div>
            </div>
          )}

          {result.must_win_mode && (
            <div className="flex items-center gap-2 p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg">
              <AlertCircle className="h-4 w-4 text-orange-500" />
              <span className="text-sm font-medium text-orange-500">Must-Win Mode Active</span>
            </div>
          )}
          
          <div className="space-y-2">
            <p className="text-sm font-medium">AI Analysis</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {result.summary}
            </p>
          </div>

          {result.key_factors && result.key_factors.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Key Factors</p>
              <ul className="space-y-1">
                {result.key_factors.map((factor, idx) => (
                  <li key={idx} className="text-sm text-muted-foreground leading-relaxed flex items-start gap-2">
                    <span className="text-primary mt-1">•</span>
                    <span>{factor}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="pt-2">
            <div className="flex justify-between text-xs text-muted-foreground mb-2">
              <span>Confidence Level</span>
              <span>{result.confidence}%</span>
            </div>
            <Progress value={result.confidence} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* Positional Analysis */}
      <Card>
        <CardHeader>
          <CardTitle>Positional Impact Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {positionalData.map((pos: any) => {
              const change = pos.delta ?? (pos.after - pos.before);
              const isPositive = change > 0;
              
              return (
                <div key={pos.position} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge className="w-16 justify-center">{pos.position}</Badge>
                      <span className="text-sm text-muted-foreground">{pos.impact}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {isPositive ? (
                        <TrendingUp className="h-4 w-4 text-green-500" />
                      ) : change < 0 ? (
                        <TrendingDown className="h-4 w-4 text-red-500" />
                      ) : null}
                      <span className={`text-sm font-bold ${isPositive ? 'text-green-500' : change < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                        {change > 0 ? '+' : ''}{change.toFixed(1)}
                      </span>
                    </div>
                  </div>
                  {pos.before !== undefined && pos.after !== undefined && (
                    <div className="flex gap-2 text-xs">
                      <span className="text-muted-foreground">Before: {pos.before.toFixed(1)}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-semibold">After: {pos.after.toFixed(1)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Weekly Projections */}
      {result.weeklyProjections && result.weeklyProjections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Rest-of-Season Weekly Projections</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {result.weeklyProjections.map((week) => {
                const change = week.after - week.before;
                return (
                  <div key={week.week} className="flex items-center justify-between p-2 rounded bg-muted/50">
                    <span className="text-sm font-medium">Week {week.week}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-muted-foreground">{week.before.toFixed(1)}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-sm font-semibold">{week.after.toFixed(1)}</span>
                      <span className={`text-sm font-bold w-16 text-right ${change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {change >= 0 ? '+' : ''}{change.toFixed(1)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
