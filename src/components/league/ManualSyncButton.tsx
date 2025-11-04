import { useState } from "react";
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

  const handleSync = async () => {
    setIsSyncing(true);
    
    try {
      toast.info("Syncing league data...", { duration: 2000 });

      // Sync transactions
      const { data: transactionsData, error: transactionsError } = await supabase.functions.invoke(
        'ingest-league-transactions',
        { body: { leagueId } }
      );

      if (transactionsError) {
        throw new Error(`Transactions sync failed: ${transactionsError.message}`);
      }

      // Sync rosters
      const { data: rostersData, error: rostersError } = await supabase.functions.invoke(
        'ingest-roster-snapshots',
        { body: { leagueId } }
      );

      if (rostersError) {
        console.warn("Rosters sync warning:", rostersError);
        // Don't throw - roster sync is less critical
      }

      toast.success(
        `✓ Synced ${transactionsData?.transactionsProcessed || 0} transactions and ${rostersData?.rosterEntriesProcessed || 0} roster entries`
      );

      onSyncComplete?.();
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
