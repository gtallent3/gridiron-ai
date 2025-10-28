import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calculator, TrendingUp, Loader2, RefreshCw } from 'lucide-react';
import { usePlayerValues } from '@/hooks/usePlayerValues';
import { usePositionalStrengths } from '@/hooks/usePositionalStrengths';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';

interface ComputeValuesCardProps {
  leagueId: string;
}

export function ComputeValuesCard({ leagueId }: ComputeValuesCardProps) {
  const playerValues = usePlayerValues(leagueId);
  const positionalStrengths = usePositionalStrengths(leagueId);

  const handleComputeAll = async () => {
    await playerValues.computeValues();
    await positionalStrengths.computeStrengths();
  };

  const isComputing = playerValues.isLoading || positionalStrengths.isLoading;
  const hasData = playerValues.values.length > 0 && positionalStrengths.strengths.length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="w-5 h-5" />
              Trade Intelligence System
            </CardTitle>
            <CardDescription className="mt-1">
              Compute player values and positional rankings for accurate trade analysis
            </CardDescription>
          </div>
          <Button
            onClick={handleComputeAll}
            disabled={isComputing}
            variant={hasData ? 'outline' : 'default'}
            size="sm"
          >
            {isComputing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Computing...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                {hasData ? 'Refresh' : 'Compute'}
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Player Values</span>
              {playerValues.values.length > 0 && (
                <Badge variant="secondary">
                  {playerValues.values.length} players
                </Badge>
              )}
            </div>
            {playerValues.lastUpdated && (
              <p className="text-xs text-muted-foreground">
                Updated {formatDistanceToNow(playerValues.lastUpdated, { addSuffix: true })}
              </p>
            )}
            {!playerValues.lastUpdated && !isComputing && (
              <p className="text-xs text-muted-foreground">Not computed yet</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Positional Rankings</span>
              {positionalStrengths.strengths.length > 0 && (
                <Badge variant="secondary">
                  <TrendingUp className="w-3 h-3 mr-1" />
                  Updated
                </Badge>
              )}
            </div>
            {positionalStrengths.lastUpdated && (
              <p className="text-xs text-muted-foreground">
                Updated {formatDistanceToNow(positionalStrengths.lastUpdated, { addSuffix: true })}
              </p>
            )}
            {!positionalStrengths.lastUpdated && !isComputing && (
              <p className="text-xs text-muted-foreground">Not computed yet</p>
            )}
          </div>
        </div>

        {!hasData && !isComputing && (
          <div className="mt-4 p-4 bg-muted/50 rounded-lg">
            <p className="text-sm text-muted-foreground">
              💡 Compute player values to enable advanced trade analysis with positional fit bonuses,
              best player detection, and league-aware recommendations.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
