import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy, TrendingUp, TrendingDown, BarChart3 } from "lucide-react";

interface SeasonSummary {
  totalPoints: number;
  avgPoints: number;
  bestWeek: { week: number; points: number };
  worstWeek: { week: number; points: number };
  weeksPlayed: number;
}

export function SeasonSummaryCard({ summary }: { summary: SeasonSummary }) {
  const stats = [
    { label: "Total Points", value: summary.totalPoints.toFixed(1), icon: Trophy, color: "text-primary" },
    { label: "Avg / Week", value: summary.avgPoints.toFixed(1), icon: BarChart3, color: "text-blue-400" },
    {
      label: "Best Week",
      value: `${summary.bestWeek.points.toFixed(1)} (W${summary.bestWeek.week})`,
      icon: TrendingUp,
      color: "text-green-400",
    },
    {
      label: "Worst Week",
      value: `${summary.worstWeek.points.toFixed(1)} (W${summary.worstWeek.week})`,
      icon: TrendingDown,
      color: "text-red-400",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Season Summary</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          {stats.map((stat) => (
            <div key={stat.label} className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30">
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
              <div>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="text-sm font-semibold">{stat.value}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Based on {summary.weeksPlayed} weeks of data
        </p>
      </CardContent>
    </Card>
  );
}
