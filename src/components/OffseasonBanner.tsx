import { useState } from "react";
import { SeasonState } from "@/lib/nflWeekUtils";
import { Calendar, Snowflake, Flag, Trophy, Database, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const STATE_CONFIG: Record<string, { icon: typeof Calendar; message: string; accent: string }> = {
  [SeasonState.OFFSEASON]: {
    icon: Snowflake,
    message: "The 2025 season is in the books. Mock draft season is open — build your board, test strategies, and get ready for September.",
    accent: "border-blue-500/30 bg-blue-500/5",
  },
  [SeasonState.PRE_SEASON]: {
    icon: Flag,
    message: "Preseason is underway! Your draft is coming up fast — check rankings and run a mock draft to sharpen your strategy.",
    accent: "border-yellow-500/30 bg-yellow-500/5",
  },
  [SeasonState.POSTSEASON]: {
    icon: Trophy,
    message: "The 2025 season is complete! Review your season recap and start prepping for the 2026 draft.",
    accent: "border-primary/30 bg-primary/5",
  },
};

type BackfillStatus = "idle" | "ingesting" | "done" | "error";

export function OffseasonBanner({ seasonState, showBackfill = false }: { seasonState: SeasonState; showBackfill?: boolean }) {
  const config = STATE_CONFIG[seasonState];
  const [status, setStatus] = useState<BackfillStatus>("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  if (!config) return null;

  const Icon = config.icon;

  const handleBackfill = async () => {
    setStatus("ingesting");
    setProgress("Downloading player database from Sleeper...");
    setError("");

    const season = 2025;
    const RELEVANT_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated — please sign in again");

      // Step 1: Fetch Sleeper player database (names, positions, teams)
      const playersResp = await fetch("https://api.sleeper.app/v1/players/nfl");
      if (!playersResp.ok) throw new Error(`Failed to fetch player data (HTTP ${playersResp.status})`);
      const players: Record<string, any> = await playersResp.json();

      // Step 2: Fetch weekly stats from Sleeper for each week
      const records: any[] = [];
      for (let week = 1; week <= 18; week++) {
        setProgress(`Fetching week ${week} of 18 stats...`);
        const statsResp = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${season}/${week}`);
        if (!statsResp.ok) continue;

        const weekStats: Record<string, any> = await statsResp.json();
        if (!weekStats || typeof weekStats !== "object") continue;

        for (const [playerId, stats] of Object.entries(weekStats)) {
          const player = players[playerId];
          if (!player) continue;

          const position = player.position;
          if (!RELEVANT_POSITIONS.has(position)) continue;

          const ptsPpr = stats.pts_ppr ?? 0;
          const ptsStd = stats.pts_std ?? 0;
          const ptsHalfPpr = stats.pts_half_ppr ?? (ptsStd + (stats.rec ?? 0) * 0.5);
          if (ptsPpr === 0 && ptsStd === 0) continue;

          records.push({
            player_id: playerId,
            player_name: player.full_name || `${player.first_name || ""} ${player.last_name || ""}`.trim(),
            position,
            team: player.team || stats.team || "FA",
            week,
            season,
            passing_yards: stats.pass_yd ?? 0,
            passing_tds: stats.pass_td ?? 0,
            passing_ints: stats.pass_int ?? 0,
            rushing_yards: stats.rush_yd ?? 0,
            rushing_tds: stats.rush_td ?? 0,
            receiving_yards: stats.rec_yd ?? 0,
            receiving_tds: stats.rec_td ?? 0,
            receptions: stats.rec ?? 0,
            fantasy_points_std: parseFloat(ptsStd.toFixed(2)),
            fantasy_points_ppr: parseFloat(ptsPpr.toFixed(2)),
            fantasy_points_half_ppr: parseFloat(ptsHalfPpr.toFixed(2)),
          });
        }
      }

      if (records.length === 0) throw new Error(`No stat records found for the ${season} season`);

      // Step 3: Upsert into actual_weekly_points in batches
      setProgress(`Inserting ${records.length.toLocaleString()} records into database...`);
      const batchSize = 500;
      let totalInserted = 0;

      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const { error: upsertError } = await supabase
          .from("actual_weekly_points")
          .upsert(batch, { onConflict: "player_id,week,season", ignoreDuplicates: false });

        if (upsertError) throw new Error(`Database insert failed: ${upsertError.message}`);
        totalInserted += batch.length;
        setProgress(`Inserted ${totalInserted.toLocaleString()} / ${records.length.toLocaleString()} records...`);
      }

      setProgress(`Backfill complete! ${totalInserted.toLocaleString()} player stat records imported.`);
      setStatus("done");
    } catch (err: any) {
      setError(err?.message || "Unknown error");
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

          {status === "ingesting" && (
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
