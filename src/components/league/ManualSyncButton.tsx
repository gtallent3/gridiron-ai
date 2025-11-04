import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface ManualSyncButtonProps {
  leagueId: string;
  onSyncComplete?: () => void;
}

export function ManualSyncButton({ leagueId, onSyncComplete }: ManualSyncButtonProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [platform, setPlatform] = useState<string>('');

  useEffect(() => {
    const fetchLeaguePlatform = async () => {
      const { data } = await supabase
        .from('connected_leagues')
        .select('platform')
        .eq('id', leagueId)
        .single();
      
      if (data) setPlatform(data.platform);
    };

    fetchLeaguePlatform();
  }, [leagueId]);

  const handleSync = async () => {
    setIsSyncing(true);
    
    try {
      toast.info("Syncing league data...", { duration: 2000 });

      if (platform === 'yahoo') {
        // Yahoo-specific sync
        const { data, error } = await supabase.functions.invoke(
          'resync-yahoo-league',
          { body: { leagueId } }
        );

        if (error) {
          throw new Error(`Yahoo sync failed: ${error.message}`);
        }

        toast.success(`✓ Synced ${data?.teamsSynced || 0} teams with updated rosters`);
      } else {
        // ESPN/Sleeper sync (transactions + rosters)
        const { data: transactionsData, error: transactionsError } = await supabase.functions.invoke(
          'ingest-league-transactions',
          { body: { leagueId } }
        );

        if (transactionsError) {
          throw new Error(`Transactions sync failed: ${transactionsError.message}`);
        }

        const { data: rostersData, error: rostersError } = await supabase.functions.invoke(
          'ingest-roster-snapshots',
          { body: { leagueId } }
        );

        if (rostersError) {
          console.warn("Rosters sync warning:", rostersError);
        }

        toast.success(
          `✓ Synced ${transactionsData?.transactionsProcessed || 0} transactions and ${rostersData?.rosterEntriesProcessed || 0} roster entries`
        );
      }

      // Force a small delay to ensure DB writes complete
      await new Promise(resolve => setTimeout(resolve, 500));
      
      onSyncComplete?.();
      
      // Force page reload for Yahoo to ensure fresh data
      if (platform === 'yahoo') {
        window.location.reload();
      }
    } catch (error) {
      console.error("Sync error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to sync data");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Button
      onClick={handleSync}
      disabled={isSyncing}
      variant="outline"
      size="sm"
      className="gap-2"
    >
      <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
      {isSyncing ? "Syncing..." : "Sync League Data"}
    </Button>
  );
}
