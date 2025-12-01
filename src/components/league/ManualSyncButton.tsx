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
      } else if (platform === 'espn') {
        // ESPN sync
        const { data, error } = await supabase.functions.invoke(
          'resync-espn-league',
          { body: { leagueId } }
        );

        if (error) {
          throw new Error(`ESPN sync failed: ${error.message}`);
        }

        toast.success(`✓ Synced ${data?.teamsSynced || 0} teams with updated rosters`);
      } else if (platform === 'sleeper') {
        // Sleeper sync
        const { data, error } = await supabase.functions.invoke(
          'resync-sleeper-league',
          { body: { leagueId } }
        );

        if (error) {
          throw new Error(`Sleeper sync failed: ${error.message}`);
        }

        toast.success(`✓ Synced ${data?.teamsSynced || 0} teams with updated rosters`);
      } else {
        throw new Error(`Unknown platform: ${platform}`);
      }

      // Force a small delay to ensure DB writes complete
      await new Promise(resolve => setTimeout(resolve, 500));
      
      onSyncComplete?.();
      
      // Force page reload to ensure fresh data
      window.location.reload();
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
