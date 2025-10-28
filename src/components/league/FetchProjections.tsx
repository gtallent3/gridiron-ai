import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface FetchProjectionsProps {
  leagueId: string;
}

export function FetchProjections({ leagueId }: FetchProjectionsProps) {
  const [startWeek, setStartWeek] = useState(9);
  const [endWeek, setEndWeek] = useState(18);
  const [loading, setLoading] = useState(false);

  const handleFetch = async () => {
    if (startWeek < 1 || endWeek > 18 || startWeek > endWeek) {
      toast.error('Invalid week range (must be 1-18 and start <= end)');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-espn-projections', {
        body: { leagueId, startWeek, endWeek }
      });

      if (error) throw error;

      if (data.success) {
        toast.success(`Fetched ${data.projections_inserted} projections for weeks ${startWeek}-${endWeek}`);
      } else {
        toast.error(data.message || 'Failed to fetch projections');
      }
    } catch (error) {
      console.error('Error fetching projections:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to fetch projections');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fetch ESPN Projections</CardTitle>
        <CardDescription>
          Fetch projection data and populate the player pool for specific weeks. 
          Note: ESPN typically only provides data for current and upcoming weeks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="startWeek">Start Week</Label>
            <Input
              id="startWeek"
              type="number"
              min={1}
              max={18}
              value={startWeek}
              onChange={(e) => setStartWeek(parseInt(e.target.value))}
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="endWeek">End Week</Label>
            <Input
              id="endWeek"
              type="number"
              min={1}
              max={18}
              value={endWeek}
              onChange={(e) => setEndWeek(parseInt(e.target.value))}
              disabled={loading}
            />
          </div>
        </div>
        <Button onClick={handleFetch} disabled={loading} className="w-full">
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Fetch Projections
        </Button>
      </CardContent>
    </Card>
  );
}
