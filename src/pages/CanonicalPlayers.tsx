import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Users, Database, Link as LinkIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export default function CanonicalPlayers() {
  const [mapping, setMapping] = useState(false);
  const [populating, setPopulating] = useState(false);
  const [resetPool, setResetPool] = useState(false);
  const [populateProgress, setPopulateProgress] = useState<string>("");
  const { toast } = useToast();

  const runMapping = async () => {
    setMapping(true);
    try {
      toast({
        title: "Starting Player Mapping",
        description: "Matching Sleeper and NFL player IDs..."
      });

      const { data, error } = await supabase.functions.invoke('map-canonical-players');
      
      if (error) throw error;

      toast({
        title: "Mapping Complete",
        description: `${data.matched} matched, ${data.created} created, ${data.unmatched} unmatched`
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setMapping(false);
    }
  };

  const runPopulation = async () => {
    setPopulating(true);
    setPopulateProgress("");
    
    let totalSleeperInserted = 0;
    let totalNflInserted = 0;
    let iteration = 0;
    let nextSleeperId: string | null = null;
    let nextNflId: string | null = null;
    let hasMoreSleeper = true;
    let hasMoreNfl = true;

    try {
      toast({
        title: "Starting Auto-Resume Population",
        description: resetPool 
          ? "Resetting and filling player pool..." 
          : "Resuming player pool population..."
      });

      while (hasMoreSleeper || hasMoreNfl) {
        iteration++;
        setPopulateProgress(`Batch ${iteration}: Processing...`);

        const body: any = {};
        if (iteration === 1 && resetPool) {
          body.reset = true;
        }
        if (nextSleeperId) body.startSleeperId = nextSleeperId;
        if (nextNflId) body.startNflId = nextNflId;

        const { data, error } = await supabase.functions.invoke('populate-player-pool', {
          body
        });
        
        if (error) throw error;

        totalSleeperInserted += data.sleeperInserted || 0;
        totalNflInserted += data.nflInserted || 0;
        nextSleeperId = data.nextSleeperId;
        nextNflId = data.nextNflId;
        hasMoreSleeper = data.hasMoreSleeper || false;
        hasMoreNfl = data.hasMoreNfl || false;

        setPopulateProgress(
          `Batch ${iteration}: +${data.sleeperInserted} projections, +${data.nflInserted} actuals (Total: ${totalSleeperInserted} projections, ${totalNflInserted} actuals)`
        );

        // Small delay to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      toast({
        title: "Population Complete ✅",
        description: `Total: ${totalSleeperInserted} projections, ${totalNflInserted} actuals inserted across ${iteration} batches`
      });
      setPopulateProgress(`Complete: ${totalSleeperInserted} projections, ${totalNflInserted} actuals`);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
      setPopulateProgress(`Error after batch ${iteration}`);
    } finally {
      setPopulating(false);
      if (resetPool) setResetPool(false);
    }
  };

  const runFullPipeline = async () => {
    await runMapping();
    await new Promise(resolve => setTimeout(resolve, 2000));
    await runPopulation();
  };

  return (
    <div className="container mx-auto p-6 pt-24 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Canonical Player System</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Unified player pool with linked Sleeper & NFL IDs
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LinkIcon className="h-5 w-5" />
              Step 1: Map Players
            </CardTitle>
            <CardDescription>
              Match Sleeper and NFL player IDs by name & position
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={runMapping} 
              disabled={mapping}
              className="w-full"
            >
              {mapping && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Run Mapping
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Step 2: Populate Pool
            </CardTitle>
            <CardDescription>
              Auto-resume until all data is processed (~155k rows)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="reset" 
                checked={resetPool}
                onCheckedChange={(checked) => setResetPool(checked as boolean)}
                disabled={populating}
              />
              <Label 
                htmlFor="reset" 
                className="text-sm font-normal cursor-pointer"
              >
                Reset pool before populating (clears existing data)
              </Label>
            </div>
            {populateProgress && (
              <p className="text-xs text-muted-foreground">{populateProgress}</p>
            )}
            <Button 
              onClick={runPopulation} 
              disabled={populating}
              className="w-full"
            >
              {populating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {populating ? "Auto-Resuming..." : "Auto-Resume Populate"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Full Pipeline
            </CardTitle>
            <CardDescription>
              Run both steps in sequence
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={runFullPipeline} 
              disabled={mapping || populating}
              variant="default"
              className="w-full"
            >
              {(mapping || populating) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Run Full Pipeline
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>How It Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="font-semibold mb-2">🔗 Canonical Players Table</h3>
            <p className="text-sm text-muted-foreground">
              Source of truth that links player IDs across all data sources (Sleeper, NFL, ESPN, Yahoo).
              Each player has one canonical ID that unifies all their external IDs.
            </p>
          </div>
          
          <div>
            <h3 className="font-semibold mb-2">🎯 Matching Algorithm</h3>
            <p className="text-sm text-muted-foreground">
              Players are matched by normalized name + position. Team affiliation is used as a tiebreaker
              for ambiguous cases. Unmatched players are logged for manual review.
            </p>
          </div>

          <div>
            <h3 className="font-semibold mb-2">📊 Player Pool V2</h3>
            <p className="text-sm text-muted-foreground">
              Unified dataset combining actual stats (nfl_fantasy_points) and projections (sleeper_projections).
              All data is linked via canonical_player_id, eliminating duplicate players like Bo Nix.
            </p>
          </div>

          <div>
            <h3 className="font-semibold mb-2">💎 Trade Values View</h3>
            <p className="text-sm text-muted-foreground">
              The player_values_view provides a clean interface for trade analysis, joining canonical player
              info with their stats across all weeks and sources.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
