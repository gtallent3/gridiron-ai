import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

// FantasyCalc public values API — returns ~50KB JSON, no auth needed
const FC_URL =
  "https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&ppr=1&superflex=false";

const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resp = await fetch(FC_URL, {
      headers: { "Accept": "application/json" },
    });

    if (!resp.ok) {
      throw new Error(`FantasyCalc API returned ${resp.status}`);
    }

    const raw: any[] = await resp.json();

    const players = raw
      .filter((entry) => {
        const pos = entry?.player?.position;
        return pos && POSITIONS.has(pos === "DST" ? "DEF" : pos);
      })
      .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
      .slice(0, 300)
      .map((entry, idx) => ({
        name: entry.player.name,
        position: entry.player.position === "DST" ? "DEF" : entry.player.position,
        team: entry.player.maybeTeam || "FA",
        adp: idx + 1,
        byeWeek: entry.player.maybeBye ?? undefined,
      }));

    if (players.length === 0) {
      throw new Error("No players returned from FantasyCalc");
    }

    return new Response(JSON.stringify(players), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message ?? "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
