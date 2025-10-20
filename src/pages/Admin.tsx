import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const Admin = () => {
  const [week, setWeek] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [backfillAll, setBackfillAll] = useState(false);

  const handleBackfill = async (targetWeek: number) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('backfill-player-valuations', {
        body: { week: targetWeek }
      });

      if (error) throw error;

      toast.success(`Week ${targetWeek} backfilled successfully`);
      console.log('Backfill result:', data);
    } catch (error) {
      console.error('Backfill error:', error);
      toast.error(`Failed to backfill week ${targetWeek}`);
    } finally {
      setLoading(false);
    }
  };

  const handleBackfillAll = async () => {
    setBackfillAll(true);
    for (let w = 1; w <= 6; w++) {
      toast.info(`Backfilling week ${w}...`);
      await handleBackfill(w);
      // Add a small delay between weeks to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    setBackfillAll(false);
    toast.success('All weeks backfilled!');
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <Card>
        <CardHeader>
          <CardTitle>Player Valuations Backfill</CardTitle>
          <CardDescription>
            Backfill historical player valuations data for weeks 1-6
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="text-sm font-medium mb-2 block">
                  Week to Backfill (1-6)
                </label>
                <Input
                  type="number"
                  min={1}
                  max={6}
                  value={week}
                  onChange={(e) => setWeek(Number(e.target.value))}
                  disabled={loading || backfillAll}
                />
              </div>
              <Button
                onClick={() => handleBackfill(week)}
                disabled={loading || backfillAll || week < 1 || week > 6}
              >
                {loading && !backfillAll && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Backfill Week {week}
              </Button>
            </div>

            <div className="border-t pt-4">
              <Button
                onClick={handleBackfillAll}
                disabled={loading || backfillAll}
                variant="outline"
                className="w-full"
              >
                {backfillAll && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Backfill All Weeks (1-6)
              </Button>
              <p className="text-sm text-muted-foreground mt-2">
                This will sequentially backfill weeks 1 through 6 with a 2-second delay between each.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Admin;
