import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useSubscription } from '@/hooks/useSubscription';
import { useTokens } from '@/hooks/useTokens';
import { getCurrentNFLWeek } from '@/lib/nflWeekUtils';
import { Lock, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

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
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [unlockedWeek, setUnlockedWeek] = useState<number | null>(null);
  
  const { subscription } = useSubscription();
  const { balance, hasUnlimited, refreshBalance } = useTokens();
  const currentWeekInfo = getCurrentNFLWeek();
  const currentWeek = currentWeekInfo.week;
  
  // Check if user has access
  const isSubscriber = subscription.subscribed || hasUnlimited;

  useEffect(() => {
    fetchPositionalStrengths();
    checkUnlockStatus();
  }, [leagueId]);
  
  useEffect(() => {
    checkUnlockStatus();
  }, [currentWeek, isSubscriber]);

  const checkUnlockStatus = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data, error } = await supabase
        .from('user_tokens')
        .select('rankings_unlocked_week')
        .eq('user_id', user.id)
        .single();
      
      if (error) throw error;
      
      setUnlockedWeek(data?.rankings_unlocked_week || null);
      setIsUnlocked(isSubscriber || data?.rankings_unlocked_week === currentWeek);
    } catch (error) {
      console.error('Error checking unlock status:', error);
    }
  };

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
  
  const handleUnlock = async () => {
    setShowUnlockDialog(false);
    setIsUnlocking(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('unlock-rankings', {
        body: { currentWeek },
      });
      
      if (error) throw error;
      
      if (data.insufficient) {
        toast.error('Insufficient Tokens', {
          description: 'You need 1 token to unlock rankings. Visit the shop to get more tokens.',
        });
        return;
      }
      
      if (data.success) {
        setIsUnlocked(true);
        setUnlockedWeek(currentWeek);
        await refreshBalance();
        toast.success('Rankings Unlocked!', {
          description: data.unlimited 
            ? 'Rankings unlocked with your subscription.' 
            : `Rankings unlocked for Week ${currentWeek}.`,
        });
      }
    } catch (error) {
      console.error('Error unlocking rankings:', error);
      toast.error('Failed to unlock rankings', {
        description: 'Please try again.',
      });
    } finally {
      setIsUnlocking(false);
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
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>League Positional Rankings</CardTitle>
              <CardDescription>
                Team strengths by position (hover for details)
              </CardDescription>
            </div>
            {isSubscriber && (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle className="h-3 w-3" />
                Subscriber Access
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="relative">
            {!isUnlocked && (
              <div className="absolute inset-0 z-10 bg-background/80 backdrop-blur-md rounded-md flex items-center justify-center">
                <div className="text-center space-y-4 max-w-md p-6">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-2">
                    <Lock className="h-8 w-8 text-primary" />
                  </div>
                  <h3 className="text-xl font-semibold">Unlock This Week's Rankings</h3>
                  <p className="text-muted-foreground">
                    Get detailed positional strength analysis for Week {currentWeek}
                  </p>
                  <div className="flex flex-col gap-2">
                    <Button 
                      onClick={() => setShowUnlockDialog(true)}
                      disabled={isUnlocking}
                      size="lg"
                    >
                      {isUnlocking ? 'Unlocking...' : 'Reveal Rankings (1 Token)'}
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={() => window.location.href = '/shop'}
                    >
                      Subscribe for Unlimited Access
                    </Button>
                  </div>
                  {balance !== null && !hasUnlimited && (
                    <p className="text-sm text-muted-foreground">
                      Your balance: {balance} token{balance !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
              </div>
            )}
            <div className={!isUnlocked ? 'filter blur-sm pointer-events-none' : ''}>
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
      </div>
    </div>
        </CardContent>
      </Card>
      
      <AlertDialog open={showUnlockDialog} onOpenChange={setShowUnlockDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlock Positional Rankings?</AlertDialogTitle>
            <AlertDialogDescription>
              Spend 1 token to unlock this week's positional rankings analysis. 
              This will remain unlocked for the entire week.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleUnlock}>
              Confirm (1 Token)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
