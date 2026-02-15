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
    message: "The 2025 season is complete! Check your final standings and season recap.",
    accent: "border-primary/30 bg-primary/5",
  },
};

type BackfillStatus = "idle" | "ingesting" | "done" | "error";

// Simple CSV parser that handles quoted fields
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV split (handles most cases; nflverse CSVs are clean)
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === "," && !inQuotes) { values.push(current.trim()); current = ""; continue; }
      current += ch;
    }
    values.push(current.trim());

    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

export function OffseasonBanner({ seasonState, showBackfill = false }: { seasonState: SeasonState; showBackfill?: boolean }) {
  const config = STATE_CONFIG[seasonState];
  const [status, setStatus] = useState<BackfillStatus>("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  if (!config) return null;

  const Icon = config.icon;

  const handleBackfill = async () => {
    setStatus("ingesting");
    setProgress("Downloading 2025 season stats from nflverse...");
    setError("");

    const season = 2025;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated — please sign in again");

      // Step 1: Fetch CSV directly from nflverse (public GitHub, CORS-friendly)
      const csvUrl = `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;
      const resp = await fetch(csvUrl);
      if (!resp.ok) throw new Error(`Failed to download stats CSV (HTTP ${resp.status})`);

      const csvText = await resp.text();
      setProgress("Parsing stats data...");

      // Step 2: Parse CSV
      const rows = parseCSV(csvText);
      if (rows.length === 0) throw new Error("CSV was empty or could not be parsed");

      setProgress(`Parsed ${rows.length.toLocaleString()} rows. Computing fantasy points...`);

      // Step 3: Build records with fantasy point calculations
      const toFloat = (v: string | undefined) => {
        const n = parseFloat(v || "0");
        return Number.isFinite(n) ? n : 0;
      };
      const toInt = (v: string | undefined) => {
        const n = parseInt(v || "0", 10);
        return Number.isFinite(n) ? n : 0;
      };
      const getFirst = (row: Record<string, string>, keys: string[]) => {
        for (const k of keys) {
          const v = row[k];
          if (v !== undefined && v !== "") return v;
        }
        return "";
      };

      const records: any[] = [];
      for (const row of rows) {
        const seasonVal = toInt(getFirst(row, ["season"]));
        if (seasonVal !== season) continue;

        const week = toInt(getFirst(row, ["week"]));
        const player_id = getFirst(row, ["player_id"]);
        const player_name = getFirst(row, ["player_display_name", "player_name"]);
        const position = getFirst(row, ["position"]);
        const team = getFirst(row, ["recent_team", "team"]);
        if (!player_id || !week) continue;

        const passing_yards = toFloat(getFirst(row, ["passing_yards"]));
        const passing_tds = toInt(getFirst(row, ["passing_tds"]));
        const passing_ints = toInt(getFirst(row, ["passing_interceptions", "interceptions"]));
        const rushing_yards = toFloat(getFirst(row, ["rushing_yards"]));
        const rushing_tds = toInt(getFirst(row, ["rushing_tds"]));
        const receiving_yards = toFloat(getFirst(row, ["receiving_yards"]));
        const receiving_tds = toInt(getFirst(row, ["receiving_tds"]));
        const receptions = toInt(getFirst(row, ["receptions"]));

        const fantasy_points_std =
          passing_yards * 0.04 + passing_tds * 4 + passing_ints * -2 +
          rushing_yards * 0.1 + rushing_tds * 6 +
          receiving_yards * 0.1 + receiving_tds * 6;

        const fantasy_points_ppr = fantasy_points_std + receptions * 1;
        const fantasy_points_half_ppr = fantasy_points_std + receptions * 0.5;

        records.push({
          player_id, player_name, position, team, week,
          season: seasonVal,
          passing_yards, passing_tds, passing_ints,
          rushing_yards, rushing_tds,
          receiving_yards, receiving_tds, receptions,
          fantasy_points_std: parseFloat(fantasy_points_std.toFixed(2)),
          fantasy_points_ppr: parseFloat(fantasy_points_ppr.toFixed(2)),
          fantasy_points_half_ppr: parseFloat(fantasy_points_half_ppr.toFixed(2)),
        });
      }

      if (records.length === 0) throw new Error(`No stat records found for season ${season}`);

      // Step 4: Upsert into actual_weekly_points in batches
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
