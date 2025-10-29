// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function computeAppliedTotal(applied: Record<string, any> | undefined, fallback: any) {
  let fp = fallback;
  if ((fp == null || Number.isNaN(fp)) && applied && Object.keys(applied).length) {
    fp = Object.values(applied).reduce(
      (sum: number, v: any) => sum + (typeof v === 'number' ? v : parseFloat(String(v)) || 0),
      0
    );
  }
  return fp;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { leagueId, season, week: rawWeek, swid: bodySwid, espn_s2: bodyEspnS2 } = await req.json();
    const week = Number(rawWeek);

    if (!leagueId || !season || !week) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: leagueId, season, week' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get league data
    const { data: leagueData, error: leagueError } = await supabase
      .from('connected_leagues')
      .select('league_id, id, platform, user_id')
      .eq('id', leagueId)
      .single();

    if (leagueError || !leagueData) {
      return new Response(JSON.stringify({ error: 'League not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const espnLeagueId = leagueData.league_id; // kept for summary & schema symmetry if needed

    // Resolve credentials
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

    // Ensure SWID has braces
    const swidCookie = swidVal!.startsWith('{') ? swidVal! : `{${swidVal}}`;

    // -------- Memory-safe, paginated ingest via players endpoint --------
    const SLOT_IDS = [0, 2, 4, 6, 17, 16]; // QB, RB, WR, TE, K, DST
    const PAGE_SIZE = 80;
    const ROW_CHUNK = 40;
    const MAX_PAGES_PER_SLOT = 50;

    const baseHeaders = {
      'Cookie': `espn_s2=${espnS2Val}; SWID=${swidCookie}`, // espn_s2 first
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; GridironGM/1.0)',
      'Referer': 'https://fantasy.espn.com',
    };

    const makeFilter = (slotId?: number) => ({
      players: {
        ...(slotId != null ? { filterSlotIds: { value: [slotId] } } : {}),
        filterStatsForExternalIds: { value: [season] },
        filterStatsForSourceIds: { value: [0, 1] }, // 0=actuals, 1=projections
        filterStatsForTopScoringPeriodIds: { value: 2, additionalValue: [week] },
        sortAppliedStatTotal: { sortAsc: false, sortPriority: 1, value: 1027 }, // number, not string
      },
    });

    const playersUrl = (offset: number) =>
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/players?scoringPeriodId=${week}&view=kona_player_info&limit=${PAGE_SIZE}&offset=${offset}`;

    let totalSeen = 0;
    let totalUpserts = 0;
    let totalProj = 0;
    let totalActual = 0;

    for (const slotId of SLOT_IDS) {
      const filter = makeFilter(slotId);

      for (let page = 0; page < MAX_PAGES_PER_SLOT; page++) {
        const offset = page * PAGE_SIZE;
        const url = playersUrl(offset);

        let text = '';
        try {
          const resp = await fetch(url, {
            headers: { ...baseHeaders, 'X-Fantasy-Filter': JSON.stringify(filter) },
          });
          text = await resp.text();
          if (!resp.ok || text.trim().startsWith('<') || text.includes('<html')) {
            // HTML indicates auth wall or error — stop this slot's pagination
            break;
          }
        } catch {
          break;
        }

        let arr: any[] | null = null;
        try {
          const parsed = JSON.parse(text);
          arr = Array.isArray(parsed) ? parsed : null;
        } catch {
          arr = null;
        }
        text = '' as any; // release big string ASAP

        if (!arr || arr.length === 0) break;

        totalSeen += arr.length;

        let buffer: any[] = [];
        for (let i = 0; i < arr.length; i++) {
          const p = arr[i];
          const espnId = p?.id?.toString();
          if (!espnId) { arr[i] = null; continue; }

          const name = p.fullName ?? p.player?.fullName ?? 'Unknown';
          const pos = getPosition(p.defaultPositionId ?? p.player?.defaultPositionId);
          const team = getTeamAbbreviation(p.proTeamId ?? p.player?.proTeamId);

          const pdata = p.player ?? p;
          let waiver = 'ROSTERED';
          if (pdata.status === 'FREEAGENT') waiver = 'FREEAGENT';
          else if (pdata.status === 'WAIVERS') waiver = 'WAIVERS';

          const root = Array.isArray(p.stats) ? p.stats : [];
          const nested = Array.isArray(p.player?.stats) ? p.player.stats : [];
          const stats = root.length ? root : nested;
          if (!stats?.length) { arr[i] = null; continue; }

          for (let j = 0; j < stats.length; j++) {
            const s = stats[j];
            if (s.scoringPeriodId !== week) continue;
            if (s.statSourceId !== 0 && s.statSourceId !== 1) continue;

            const applied = s.appliedStats ?? s.stats ?? {};
            const fp = computeAppliedTotal(applied, s.appliedTotal);
            if ((fp == null || fp === 0) && Object.keys(applied).length === 0) continue;

            // Keep row small — do not store bulky stats/applied blobs
            buffer.push({
              league_id: leagueData.id,
              espn_league_id: espnLeagueId,
              season,
              week,
              player_id: `espn_${espnId}`,
              player_name: name,
              position: pos,
              team,
              waiver_status: waiver,
              source: s.statSourceId === 1 ? 'espn_projection' : 'espn_actual',
              projected_fp: fp || 0,
              percent_owned: p.ownership?.percentOwned ?? 0,
              percent_started: p.ownership?.percentStarted ?? 0,
              is_owned: waiver === 'ROSTERED',
              confidence: s.statSourceId === 1 ? 0.8 : 1.0,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });

            if (s.statSourceId === 1) totalProj++; else totalActual++;

            if (buffer.length >= ROW_CHUNK) {
              const { error } = await supabase
                .from('player_pool')
                .upsert(buffer, { onConflict: 'league_id,season,week,player_id,source', ignoreDuplicates: false });
              if (error) throw error;
              totalUpserts += buffer.length;
              buffer.length = 0; // release references
            }
          }

          // Aggressively drop per-player references
          if (p.stats) delete p.stats;
          if (p.player?.stats) delete p.player.stats;
          arr[i] = null;
        }

        if (buffer.length) {
          const { error } = await supabase
            .from('player_pool')
            .upsert(buffer, { onConflict: 'league_id,season,week,player_id,source', ignoreDuplicates: false });
          if (error) throw error;
          totalUpserts += buffer.length;
          buffer.length = 0;
        }

        // Yield to GC between pages
        await sleep(0);

        if (arr.length < PAGE_SIZE) break; // reached end of this slot
      }
    }

    const summary = {
      success: true,
      season,
      week,
      espn_league_id: espnLeagueId,
      players_seen: totalSeen,
      inserted_or_updated: totalUpserts,
      projections: totalProj,
      actuals: totalActual,
    };
    console.log('ingest summary', summary);

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in ingest-espn-all-players:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
