import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ArrowLeft, Trophy, Database, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WeeklyPointsChart } from "@/components/league/recap/WeeklyPointsChart";
import { SeasonSummaryCard } from "@/components/league/recap/SeasonSummaryCard";
import { TopPerformersTable } from "@/components/league/recap/TopPerformersTable";
import { PositionalBreakdown } from "@/components/league/recap/PositionalBreakdown";

// NFL season: Sep-Dec = current year, Jan-Aug = previous year
const RECAP_SEASON = new Date().getMonth() >= 8 ? new Date().getFullYear() : new Date().getFullYear() - 1;

type BackfillStatus = "idle" | "running" | "done" | "error";

interface WeeklyData {
  week: number;
  points: number;
}

interface TopPerformer {
  playerName: string;
  position: string;
  totalPoints: number;
  gamesPlayed: number;
  avgPoints: number;
}

interface PositionData {
  position: string;
  points: number;
}

interface SeasonSummary {
  totalPoints: number;
  avgPoints: number;
  bestWeek: { week: number; points: number };
  worstWeek: { week: number; points: number };
  weeksPlayed: number;
}

export default function SeasonRecap() {
  const { leagueId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [leagueName, setLeagueName] = useState("");
  const [weeklyData, setWeeklyData] = useState<WeeklyData[]>([]);
  const [summary, setSummary] = useState<SeasonSummary | null>(null);
  const [topPerformers, setTopPerformers] = useState<TopPerformer[]>([]);
  const [positionalData, setPositionalData] = useState<PositionData[]>([]);
  const [backfillStatus, setBackfillStatus] = useState<BackfillStatus>("idle");
  const [backfillProgress, setBackfillProgress] = useState("");
  const [backfillError, setBackfillError] = useState("");

  useEffect(() => {
    fetchRecapData();
  }, [leagueId]);

  const fetchRecapData = async () => {
    try {
      setLoading(true);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }

      // Fetch league info
      const { data: league } = await supabase
        .from("connected_leagues")
        .select("league_name, scoring_type")
        .eq("id", leagueId)
        .single();

      if (!league) { navigate("/"); return; }
      setLeagueName(league.league_name);

      // Fetch user's team roster player IDs
      const { data: teams } = await supabase
        .from("user_teams")
        .select("roster")
        .eq("league_id", leagueId);

      // Collect all player names from all teams' rosters to look up
      const allPlayerNames = new Set<string>();
      const myRosterNames = new Set<string>();

      if (teams) {
        // First team is typically the user's
        for (const team of teams) {
          const roster = Array.isArray(team.roster) ? team.roster : [];
          for (const player of roster) {
            const pAny = player as any;
            const name = pAny.player_name || pAny.name;
            if (name) allPlayerNames.add(name);
          }
        }
        // User's team players
        if (teams.length > 0) {
          const myRoster = Array.isArray(teams[0].roster) ? teams[0].roster : [];
          for (const p of myRoster) {
            const pAny = p as any;
            const name = pAny.player_name || pAny.name;
            if (name) myRosterNames.add(name);
          }
        }
      }

      // Query actual_weekly_points for backfilled season stats
      const { data: poolData } = await supabase
        .from("actual_weekly_points")
        .select("player_name, position, week, fantasy_points_ppr")
        .eq("season", RECAP_SEASON)
        .gte("week", 1)
        .lte("week", 18);

      if (!poolData || poolData.length === 0) {
        setLoading(false);
        return;
      }

      // Filter to roster players
      const rosterStats = poolData.filter((r) => myRosterNames.has(r.player_name!));

      // Aggregate by week for chart
      const weekMap = new Map<number, number>();
      for (const row of rosterStats) {
        const pts = row.fantasy_points_ppr || 0;
        weekMap.set(row.week, (weekMap.get(row.week) || 0) + pts);
      }
      const weekly: WeeklyData[] = Array.from(weekMap.entries())
        .map(([week, points]) => ({ week, points: Math.round(points * 10) / 10 }))
        .sort((a, b) => a.week - b.week);
      setWeeklyData(weekly);

      // Summary
      if (weekly.length > 0) {
        const totalPoints = weekly.reduce((s, w) => s + w.points, 0);
        const avgPoints = totalPoints / weekly.length;
        const best = weekly.reduce((a, b) => (b.points > a.points ? b : a));
        const worst = weekly.reduce((a, b) => (b.points < a.points ? b : a));
        setSummary({
          totalPoints,
          avgPoints,
          bestWeek: { week: best.week, points: best.points },
          worstWeek: { week: worst.week, points: worst.points },
          weeksPlayed: weekly.length,
        });
      }

      // Top performers by total points
      const playerMap = new Map<string, { position: string; total: number; games: number }>();
      for (const row of rosterStats) {
        const key = row.player_name!;
        const existing = playerMap.get(key) || { position: row.position || "??", total: 0, games: 0 };
        existing.total += row.fantasy_points_ppr || 0;
        existing.games += 1;
        playerMap.set(key, existing);
      }
      const performers: TopPerformer[] = Array.from(playerMap.entries())
        .map(([name, data]) => ({
          playerName: name,
          position: data.position,
          totalPoints: Math.round(data.total * 10) / 10,
          gamesPlayed: data.games,
          avgPoints: Math.round((data.total / data.games) * 10) / 10,
        }))
        .sort((a, b) => b.totalPoints - a.totalPoints);
      setTopPerformers(performers);

      // Positional breakdown
      const posMap = new Map<string, number>();
      for (const row of rosterStats) {
        const pos = row.position || "??";
        posMap.set(pos, (posMap.get(pos) || 0) + (row.fantasy_points_ppr || 0));
      }
      const posData: PositionData[] = Array.from(posMap.entries())
        .map(([position, points]) => ({ position, points: Math.round(points * 10) / 10 }))
        .sort((a, b) => b.points - a.points);
      setPositionalData(posData);
    } catch (err) {
      console.error("Error fetching recap data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleBackfill = async () => {
    setBackfillStatus("running");
    setBackfillProgress("Downloading player database from Sleeper...");
    setBackfillError("");

    const RELEVANT_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated — please sign in again");

      const playersResp = await fetch("https://api.sleeper.app/v1/players/nfl");
      if (!playersResp.ok) throw new Error(`Failed to fetch player data (HTTP ${playersResp.status})`);
      const players: Record<string, any> = await playersResp.json();

      const records: any[] = [];
      for (let week = 1; week <= 18; week++) {
        setBackfillProgress(`Fetching week ${week} of 18...`);
        const statsResp = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${RECAP_SEASON}/${week}`);
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
          if (ptsPpr === 0 && ptsStd === 0) continue;
          const ptsHalfPpr = ptsStd + (stats.rec ?? 0) * 0.5;
          records.push({
            player_id: playerId,
            player_name: player.full_name || `${player.first_name || ""} ${player.last_name || ""}`.trim(),
            position,
            team: player.team || stats.team || "FA",
            week,
            season: RECAP_SEASON,
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

      if (records.length === 0) throw new Error(`No stats found for the ${RECAP_SEASON} season`);

      const batchSize = 500;
      let totalInserted = 0;
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const { error: upsertError } = await supabase
          .from("actual_weekly_points")
          .upsert(batch, { onConflict: "player_id,week,season", ignoreDuplicates: false });
        if (upsertError) throw new Error(`Insert failed: ${upsertError.message}`);
        totalInserted += batch.length;
        setBackfillProgress(`Saving ${totalInserted.toLocaleString()} / ${records.length.toLocaleString()} records...`);
      }

      setBackfillStatus("done");
      setBackfillProgress(`Done! Imported ${totalInserted.toLocaleString()} records.`);
      await fetchRecapData();
    } catch (err: any) {
      setBackfillError(err?.message || "Unknown error");
      setBackfillStatus("error");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Trophy className="h-12 w-12 text-primary animate-bounce" />
          <p className="text-sm text-muted-foreground animate-pulse">Loading season recap...</p>
        </div>
      </div>
    );
  }

  const hasData = weeklyData.length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20 mt-16">
      <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-6">
        <Button variant="ghost" onClick={() => navigate(`/league/${leagueId}`)} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to League
        </Button>

        <div className="flex items-center gap-3 mb-6">
          <Trophy className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Season Recap</h1>
            <p className="text-sm text-muted-foreground">{leagueName} — {RECAP_SEASON} Season</p>
          </div>
        </div>

        {!hasData ? (
          <div className="max-w-md mx-auto text-center py-12 space-y-4">
            <Trophy className="h-12 w-12 text-primary/40 mx-auto" />
            <div className="space-y-1">
              <h3 className="font-semibold">No season stats yet</h3>
              <p className="text-sm text-muted-foreground">
                Import {RECAP_SEASON} season stats from Sleeper to see your full season breakdown.
              </p>
            </div>

            {backfillStatus === "idle" && (
              <Button onClick={handleBackfill}>
                <Database className="h-4 w-4 mr-2" />
                Import {RECAP_SEASON} Season Stats
              </Button>
            )}

            {backfillStatus === "running" && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{backfillProgress}</span>
              </div>
            )}

            {backfillStatus === "done" && (
              <div className="flex items-center justify-center gap-2 text-sm text-green-500">
                <CheckCircle2 className="h-4 w-4" />
                <span>{backfillProgress}</span>
              </div>
            )}

            {backfillStatus === "error" && (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  <span>{backfillError}</span>
                </div>
                <Button variant="outline" onClick={handleBackfill}>
                  Retry
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {summary && <SeasonSummaryCard summary={summary} />}
            <WeeklyPointsChart data={weeklyData} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <TopPerformersTable players={topPerformers} />
              <PositionalBreakdown data={positionalData} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
