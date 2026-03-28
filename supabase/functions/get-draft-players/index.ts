import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

function computeOverallAdp(position: string, posRank: number): number {
  switch (position) {
    case "RB":  return posRank * 2.4 - 0.5;
    case "WR":  return posRank * 2.4 + 0.8;
    case "QB":  return posRank * 6.5 + 5;
    case "TE":  return posRank * 11 + 2;
    case "K":   return 150 + posRank;
    case "DEF": return 140 + posRank;
    default:    return 200 + posRank;
  }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resp = await fetch("https://api.sleeper.app/v1/players/nfl");
    if (!resp.ok) {
      throw new Error(`Sleeper API returned ${resp.status}`);
    }
    const data: Record<string, any> = await resp.json();

    // Group by position, filter to draftable players by search_rank
    const byPosition: Record<string, { name: string; team: string; posRank: number; byeWeek?: number }[]> = {};
    for (const player of Object.values(data)) {
      if (!player.position || !POSITIONS.includes(player.position)) continue;
      if (!player.search_rank || player.search_rank >= 9999) continue;

      const pos: string = player.position;
      if (!byPosition[pos]) byPosition[pos] = [];
      byPosition[pos].push({
        name: player.full_name || `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim(),
        team: player.team || "FA",
        posRank: player.search_rank,
        byeWeek: player.bye_week ?? undefined,
      });
    }

    // Sort within each position group and assign sequential rank, then compute overall ADP
    const ranked: { name: string; position: string; team: string; adp: number; byeWeek?: number }[] = [];
    for (const pos of Object.keys(byPosition)) {
      byPosition[pos].sort((a, b) => a.posRank - b.posRank);
      byPosition[pos].forEach((p, idx) => {
        ranked.push({
          name: p.name,
          position: pos,
          team: p.team,
          adp: Math.round(computeOverallAdp(pos, idx + 1)),
          byeWeek: p.byeWeek,
        });
      });
    }

    ranked.sort((a, b) => a.adp - b.adp);
    const top300 = ranked.slice(0, 300);

    return new Response(JSON.stringify(top300), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message ?? "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
