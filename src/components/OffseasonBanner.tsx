import { useState } from "react";
import { SeasonState } from "@/lib/nflWeekUtils";
import { Calendar, Snowflake, Flag, Trophy, Database, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const STATE_CONFIG: Record<string, { icon: typeof Calendar; message: string; accent: string }> = {
  [SeasonState.OFFSEASON]: {
    icon: Snowflake,
    message: "It's the offseason! Check back in September. Your leagues and historical data are still available.",
    accent: "border-blue-500/30 bg-blue-500/5",
  },
  [SeasonState.PRE_SEASON]: {
    icon: Flag,
    message: "Preseason is underway! Regular season starts soon. Review your roster and prep your lineup.",
    accent: "border-yellow-500/30 bg-yellow-500/5",
  },
  [SeasonState.POSTSEASON]: {
    icon: Trophy,
    message: "The regular season is complete! Playoffs are underway. Check your final standings.",
    accent: "border-primary/30 bg-primary/5",
  },
};

type BackfillStatus = "idle" | "ingesting" | "populating" | "done" | "error";

export function OffseasonBanner({ seasonState, showBackfill = false }: { seasonState: SeasonState; showBackfill?: boolean }) {
  const config = STATE_CONFIG[seasonState];
  const [status, setStatus] = useState<BackfillStatus>("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  if (!config) return null;

  const Icon = config.icon;

  const invokeFunction = async (fnName: string, body: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const resp = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => resp.statusText);
      throw new Error(`${fnName} failed (${resp.status}): ${text}`);
    }
    return resp.json();
  };

  const handleBackfill = async () => {
    setStatus("ingesting");
    setProgress("Downloading 2025 season stats from nflverse...");
    setError("");

    try {
      // Step 1: Ingest actual stats from nflverse CSV
      const ingestResult = await invokeFunction("ingest-nfl-fantasy-points", { season: 2025 });

      if (!ingestResult?.success) throw new Error(ingestResult?.error || "Ingest returned failure");

      const recordCount = ingestResult.records_processed || 0;
      setProgress(`Ingested ${recordCount.toLocaleString()} stat records. Populating player pool...`);
      setStatus("populating");

      // Step 2: Populate player_pool_v2 (resumable loop)
      let sleeperIdx = 0;
      let nflIdx = 0;
      let totalInserted = 0;
      let iteration = 0;
      const MAX_ITERATIONS = 50; // safety bound

      while (iteration < MAX_ITERATIONS) {
        iteration++;
        const poolResult = await invokeFunction("populate-player-pool", {
          maxBatches: 4, startSleeperIndex: sleeperIdx, startNflIndex: nflIdx, chunkSize: 500,
        });

        totalInserted += (poolResult.sleeperInserted || 0) + (poolResult.nflInserted || 0);
        setProgress(`Populating player pool... ${totalInserted.toLocaleString()} records written (batch ${iteration})`);

        const hasMore = poolResult.hasMoreSleeper || poolResult.hasMoreNfl;
        if (!hasMore) break;

        sleeperIdx = poolResult.nextSleeperIndex || sleeperIdx;
        nflIdx = poolResult.nextNflIndex || nflIdx;
      }

      setProgress(`Backfill complete! ${recordCount.toLocaleString()} stats ingested, ${totalInserted.toLocaleString()} pool records written.`);
      setStatus("done");
    } catch (err: any) {
      const msg = err?.message || "Unknown error";
      setError(msg);
      setStatus("error");
    }
  };

  return (
    <div className={`rounded-lg border p-4 mb-6 ${config.accent}`}>
      <div className="flex items-start gap-3">
        <Icon className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="flex-1 space-y-3">
          <p className="text-sm text-muted-foreground">{config.message}</p>

          {showBackfill && status === "idle" && (
            <Button variant="outline" size="sm" onClick={handleBackfill}>
              <Database className="h-4 w-4 mr-2" />
              Backfill 2025 Season Stats
            </Button>
          )}

          {(status === "ingesting" || status === "populating") && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{progress}</span>
            </div>
          )}

          {status === "done" && (
            <div className="flex items-center gap-2 text-sm text-green-500">
              <CheckCircle2 className="h-4 w-4" />
              <span>{progress}</span>
            </div>
          )}

          {status === "error" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-red-500">
                <AlertCircle className="h-4 w-4" />
                <span>Backfill failed: {error}</span>
              </div>
              <Button variant="outline" size="sm" onClick={handleBackfill}>
                Retry
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
