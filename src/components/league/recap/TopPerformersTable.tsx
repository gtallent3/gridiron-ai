import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface TopPerformer {
  playerName: string;
  position: string;
  totalPoints: number;
  gamesPlayed: number;
  avgPoints: number;
}

export function TopPerformersTable({ players }: { players: TopPerformer[] }) {
  if (!players.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Top Performers</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-2 pr-4">#</th>
                <th className="text-left py-2 pr-4">Player</th>
                <th className="text-left py-2 pr-4">Pos</th>
                <th className="text-right py-2 pr-4">GP</th>
                <th className="text-right py-2 pr-4">Total</th>
                <th className="text-right py-2">Avg</th>
              </tr>
            </thead>
            <tbody>
              {players.slice(0, 15).map((p, i) => (
                <tr key={p.playerName} className="border-b border-border/50">
                  <td className="py-2 pr-4 text-muted-foreground">{i + 1}</td>
                  <td className="py-2 pr-4 font-medium">{p.playerName}</td>
                  <td className="py-2 pr-4">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                      {p.position}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right text-muted-foreground">{p.gamesPlayed}</td>
                  <td className="py-2 pr-4 text-right font-semibold">{p.totalPoints.toFixed(1)}</td>
                  <td className="py-2 text-right text-muted-foreground">{p.avgPoints.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
