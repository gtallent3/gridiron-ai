import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface PositionalStrength {
  team_id: string;
  position: string;
  pss: number;
  rank: number;
  z_score: number;
  delta_vs_median: number;
  updated_at: string;
}

interface PositionalRankingsProps {
  leagueId: string;
  teams: any[];
}

export function PositionalRankings({ leagueId, teams }: PositionalRankingsProps) {
  const [strengths, setStrengths] = useState<PositionalStrength[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchPositionalStrengths();
  }, [leagueId]);

  const fetchPositionalStrengths = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('team_positional_strengths')
        .select('*')
        .eq('league_id', leagueId)
        .order('team_id');

      if (error) throw error;
      setStrengths(data || []);
    } catch (error) {
      console.error('Error fetching positional strengths:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getTeamName = (teamId: string) => {
    const team = teams.find(t => t.team_id === teamId);
    return team?.team_name || teamId;
  };

  const getRankColor = (zScore: number) => {
    if (zScore > 0.5) return 'bg-green-500/20 text-green-700 dark:text-green-400';
    if (zScore < -0.5) return 'bg-red-500/20 text-red-700 dark:text-red-400';
    return 'bg-gray-500/20 text-gray-700 dark:text-gray-400';
  };

  const getBarWidth = (zScore: number) => {
    // Map z-score to 0-100% width (clamp between -2 and +2)
    const clamped = Math.max(-2, Math.min(2, zScore));
    return ((clamped + 2) / 4) * 100;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>League Positional Rankings</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Group by team
  const teamGroups = new Map<string, PositionalStrength[]>();
  for (const s of strengths) {
    if (!teamGroups.has(s.team_id)) {
      teamGroups.set(s.team_id, []);
    }
    teamGroups.get(s.team_id)!.push(s);
  }

  const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];

  return (
    <Card>
      <CardHeader>
        <CardTitle>League Positional Rankings</CardTitle>
        <CardDescription>
          Team strengths by position (hover for details)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[150px]">Team</TableHead>
                {positions.map(pos => (
                  <TableHead key={pos} className="text-center min-w-[100px]">
                    {pos}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from(teamGroups.entries()).map(([teamId, teamStrengths]) => (
                <TableRow key={teamId}>
                  <TableCell className="font-medium">
                    {getTeamName(teamId)}
                  </TableCell>
                  {positions.map(pos => {
                    const strength = teamStrengths.find(s => s.position === pos);
                    if (!strength) {
                      return <TableCell key={pos} className="text-center">-</TableCell>;
                    }

                    return (
                      <TableCell key={pos} className="text-center">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex flex-col items-center gap-1">
                                <Badge
                                  variant="outline"
                                  className={getRankColor(strength.z_score)}
                                >
                                  #{strength.rank}
                                </Badge>
                                <div className="w-full bg-secondary rounded-full h-1.5">
                                  <div
                                    className={`h-1.5 rounded-full transition-all ${
                                      strength.z_score > 0.5
                                        ? 'bg-green-500'
                                        : strength.z_score < -0.5
                                        ? 'bg-red-500'
                                        : 'bg-gray-500'
                                    }`}
                                    style={{ width: `${getBarWidth(strength.z_score)}%` }}
                                  />
                                </div>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-sm space-y-1">
                                <p className="font-semibold">{pos} Strength</p>
                                <p>PSS: {strength.pss.toFixed(1)}</p>
                                <p>Z-Score: {strength.z_score.toFixed(2)}</p>
                                <p>
                                  vs Median: {strength.delta_vs_median > 0 ? '+' : ''}
                                  {strength.delta_vs_median.toFixed(1)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Updated: {new Date(strength.updated_at).toLocaleDateString()}
                                </p>
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
      </CardContent>
    </Card>
  );
}
