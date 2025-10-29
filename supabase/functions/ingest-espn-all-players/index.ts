import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Position ID to string mapping
const POSITION_MAP: Record<number, string> = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  16: 'DST',
};

// Team ID to abbreviation mapping
const TEAM_MAP: Record<number, string> = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET',
  9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA',
  16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI',
  23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH',
  29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};

function getTeamAbbreviation(teamId: number): string {
  return TEAM_MAP[teamId] || 'FA';
}

function getPosition(positionId: number): string {
  return POSITION_MAP[positionId] || 'FLEX';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { leagueId, season, week: rawWeek, slotId, swid: bodySwid, espn_s2: bodyEspnS2 } = await req.json();
    
    const week = Number(rawWeek);

    if (!leagueId || !season || !week || typeof slotId !== 'number') {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: leagueId, season, week, slotId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get league data to find ESPN league ID
    const { data: leagueData, error: leagueError } = await supabase
      .from('connected_leagues')
      .select('league_id, id, platform, user_id')
      .eq('id', leagueId)
      .single();

    if (leagueError || !leagueData) {
      return new Response(
        JSON.stringify({ error: 'League not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const espnLeagueId = leagueData.league_id;

    // Resolve credentials: prefer body, fallback to stored, and validate expiry
    let swidVal: string | undefined = bodySwid;
    let espnS2Val: string | undefined = bodyEspnS2;

    if (!swidVal || !espnS2Val) {
      const { data: cred, error: credError } = await supabase
        .from('espn_credentials')
        .select('swid_encrypted, espn_s2_encrypted, expires_at')
        .eq('user_id', leagueData.user_id)
        .eq('league_id', espnLeagueId)
        .maybeSingle();

      if (credError || !cred) {
        return new Response(
          JSON.stringify({ error: 'Missing ESPN credentials — please sign in with ESPN again.' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!cred.expires_at || new Date(cred.expires_at) <= new Date()) {
        return new Response(
          JSON.stringify({ error: 'ESPN credentials expired — please sign in with ESPN again.' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      swidVal = cred.swid_encrypted;
      espnS2Val = cred.espn_s2_encrypted;
    }

    // Ensure SWID is wrapped in braces and uppercase cookie name
    const swidCookie = swidVal!.startsWith('{') ? swidVal! : `{${swidVal}}`;

    // Build X-Fantasy-Filter for all players with both actuals and projections
    const filter = {
      players: {
        filterStatsForExternalIds: { value: [season] },
        filterStatsForSourceIds: { value: [0, 1] }, // 0=actuals, 1=projections
        filterStatsForTopScoringPeriodIds: {
          value: 2,                // MUST be a NUMBER, not array
          additionalValue: [week]  // MUST be an array
        },
        limit: 5000,
        sortAppliedStatTotal: { 
          sortAsc: false, 
          sortPriority: 1, 
          value: 1027
        },
      },
    };

    console.log(`Fetching all players for ESPN league ${espnLeagueId}, season ${season}, week ${week}`);
    
    const PAGE_SIZE = 60; // smaller pages to reduce memory
    const ROW_CHUNK = 30;  // flush very often to cap memory
    const nowISO = new Date().toISOString();
    // Build headers once (prefer espn_s2 first in cookie)
    const headers = {
      'Cookie': `espn_s2=${espnS2Val}; SWID=${swidCookie}`,
      'X-Fantasy-Filter': JSON.stringify(filter),
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; GridironGM/1.0)',
      'Referer': 'https://fantasy.espn.com',
    };

    async function fetchJson(url: string) {
      const r = await fetch(url, { headers });
      const t = await r.text();
      const html = t.trim().startsWith('<') || t.includes('<html');
      if (!r.ok || html) {
        return { ok: false as const, status: r.status, text: t };
      }
      try {
        const parsed = JSON.parse(t);
        return { ok: true as const, json: parsed as any };
      } catch (e) {
        console.error('Failed to parse ESPN JSON:', (e as Error).message, t.substring(0, 100));
        return { ok: false as const, status: 502, text: t };
      }
    }

    function playersUrl(offset: number) {
      return `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/players?scoringPeriodId=${week}&view=kona_player_info&limit=${PAGE_SIZE}&offset=${offset}`;
    }

    let totalSeen = 0;
    let totalUpserts = 0;
    let totalProj = 0;
    let totalActual = 0;

    // Page through players endpoint for a single position slice (provided via slotId param)
    {
      // Build filter per slot to reduce payload size
      const slotFilter = {
        players: {
          filterSlotIds: { value: [slotId] },
          filterStatsForExternalIds: { value: [season] },
          filterStatsForSourceIds: { value: [0, 1] }, // 0=actuals, 1=projections
          filterStatsForTopScoringPeriodIds: { value: 2, additionalValue: [week] },
        },
      };

      for (let offset = 0; ; offset += PAGE_SIZE) {
        const url = playersUrl(offset);
        // Build headers per page so large strings can be reclaimed
        const pageHeaders = {
          'Cookie': `espn_s2=${espnS2Val}; SWID=${swidCookie}`,
          'X-Fantasy-Filter': JSON.stringify(slotFilter),
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; GridironGM/1.0)',
          'Referer': 'https://fantasy.espn.com',
        };

        let text = '';
        try {
          const resp = await fetch(url, { headers: pageHeaders });
          text = await resp.text();
          if (!resp.ok || text.trim().startsWith('<') || text.includes('<html')) {
            // Stop pagination on failure
            break;
          }
        } catch (_) {
          break;
        }

        // Parse small page and release string ASAP
        let page: any[] | null = null;
        try {
          const parsed = JSON.parse(text);
          page = Array.isArray(parsed) ? parsed : null;
        } catch (_) {
          page = null;
        }
        text = '' as any; // drop reference early

        if (!page || page.length === 0) break;

        totalSeen += page.length;
        let buffer: any[] = [];

        for (let i = 0; i < page.length; i++) {
          const p = page[i];
          const espnId = p?.id?.toString();
          if (!espnId) { page[i] = null; continue; }

          const name = p.fullName ?? p.player?.fullName ?? 'Unknown';
          const positionId = p.defaultPositionId ?? p.player?.defaultPositionId;
          const position = getPosition(positionId);
          const proTeamId = p.proTeamId ?? p.player?.proTeamId;
          const team = getTeamAbbreviation(proTeamId);

          const playerData = p.player ?? p;
          let waiverStatus = 'ROSTERED';
          if (playerData.status === 'FREEAGENT') waiverStatus = 'FREEAGENT';
          else if (playerData.status === 'WAIVERS') waiverStatus = 'WAIVERS';

          const root = Array.isArray(p.stats) ? p.stats : [];
          const nested = Array.isArray(p.player?.stats) ? p.player.stats : [];
          const statsArray = root.length ? root : nested;

          if (!statsArray?.length) { page[i] = null; continue; }

          for (let j = 0; j < statsArray.length; j++) {
            const s = statsArray[j];
            if (s.scoringPeriodId !== week) continue;
            const src = s.statSourceId;
            if (src !== 0 && src !== 1) continue;

            const appliedStats = s.appliedStats ?? s.stats ?? {};
            let appliedTotal = s.appliedTotal;
            if ((appliedTotal == null || Number.isNaN(appliedTotal)) && appliedStats && Object.keys(appliedStats).length) {
              appliedTotal = Object.values(appliedStats).reduce(
                (sum: number, v: any) => sum + (typeof v === 'number' ? v : parseFloat(String(v)) || 0), 0
              );
            }
            if ((appliedTotal == null || appliedTotal === 0) && Object.keys(appliedStats).length === 0) continue;

            buffer.push({
              league_id: leagueData.id,
              espn_league_id: espnLeagueId,
              season,
              week,
              player_id: `espn_${espnId}`,
              player_name: name,
              position,
              team,
              waiver_status: waiverStatus,
              source: src === 1 ? 'espn_projection' : 'espn_actual',
              projected_fp: appliedTotal || 0,
              provider_ids: { espn: espnId },
              percent_owned: p.ownership?.percentOwned || 0,
              percent_started: p.ownership?.percentStarted || 0,
              is_owned: waiverStatus === 'ROSTERED',
              confidence: src === 1 ? 0.8 : 1.0,
              created_at: nowISO,
              updated_at: nowISO,
            });

            if (src === 1) totalProj++; else totalActual++;

            if (buffer.length >= ROW_CHUNK) {
              const { error } = await supabase.from('player_pool')
                .upsert(buffer, { onConflict: 'league_id,season,week,player_id,source', ignoreDuplicates: false });
              if (error) throw error;
              totalUpserts += buffer.length;
              buffer.length = 0; // drop references
            }
          }

          // Aggressively drop per-player references
          if (p.stats) delete p.stats;
          if (p.player?.stats) delete p.player.stats;
          page[i] = null;
        }

        if (buffer.length) {
          const { error } = await supabase.from('player_pool')
            .upsert(buffer, { onConflict: 'league_id,season,week,player_id,source', ignoreDuplicates: false });
          if (error) throw error;
          totalUpserts += buffer.length;
          buffer.length = 0;
        }

        // Drop page to free memory and yield to GC
        page = null;
        await new Promise((r) => setTimeout(r, 0));

        // If this page was smaller than PAGE_SIZE, no more pages
        if (false) break; // loop will break when next page is empty or fetch fails
      }
    }

    // League endpoint fallback disabled to reduce memory footprint

    const summary = {
      success: true,
      season,
      week,
      slotId,
      players_seen: totalSeen,
      inserted_or_updated: totalUpserts,
      projections: totalProj,
      actuals: totalActual,
    };

    console.log('Ingest complete:', summary);

    return new Response(
      JSON.stringify(summary),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in ingest-espn-all-players:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
