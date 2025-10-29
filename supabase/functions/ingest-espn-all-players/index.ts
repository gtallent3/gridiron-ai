// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ESPN slotId map: QB 0, RB 2, WR 4, TE 6, K 17, DST 16
const SLOT_NAME_TO_ID: Record<string, number> = {
  QB: 0, RB: 2, WR: 4, TE: 6, K: 17, DST: 16,
};

const POSITION_MAP: Record<number, string> = {
  1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST',
};

const TEAM_MAP: Record<number, string> = {
  1:'ATL',2:'BUF',3:'CHI',4:'CIN',5:'CLE',6:'DAL',7:'DEN',8:'DET',
  9:'GB',10:'TEN',11:'IND',12:'KC',13:'LV',14:'LAR',15:'MIA',
  16:'MIN',17:'NE',18:'NO',19:'NYG',20:'NYJ',21:'PHI',22:'ARI',
  23:'PIT',24:'LAC',25:'SF',26:'SEA',27:'TB',28:'WSH',
  29:'CAR',30:'JAX',33:'BAL',34:'HOU',
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
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Use POST' }), {
        status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { leagueId, season, week: rawWeek, slot, swid: bodySwid, espn_s2: bodyEspnS2 } = body ?? {};
    const week = Number(rawWeek);

    if (!leagueId || !season || !week) {
      return new Response(JSON.stringify({ error: 'Missing required parameters: leagueId, season, week' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Enforce single-slot mode to stay within memory limits
    const slotUpper = (typeof slot === 'string' ? slot.toUpperCase() : '').trim();
    const slotId = SLOT_NAME_TO_ID[slotUpper];
    if (slotId == null) {
      return new Response(JSON.stringify({
        error: 'Missing or invalid slot. Provide one of: "QB","RB","WR","TE","K","DST".',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Lookup connected league
    const { data: leagueData, error: leagueError } = await supabase
      .from('connected_leagues')
      .select('league_id, id, platform, user_id')
      .eq('id', leagueId)
      .single();

    if (leagueError || !leagueData) {
      return new Response(JSON.stringify({ error: 'League not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const espnLeagueId = leagueData.league_id;

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
        return new Response(JSON.stringify({
          error: 'Missing ESPN credentials — please sign in with ESPN again.',
        }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (!cred.expires_at || new Date(cred.expires_at) <= new Date()) {
        return new Response(JSON.stringify({
          error: 'ESPN credentials expired — please sign in with ESPN again.',
        }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      swidVal = cred.swid_encrypted;
      espnS2Val = cred.espn_s2_encrypted;
    }

    const swidCookie = swidVal!.startsWith('{') ? swidVal! : `{${swidVal}}`;

    // Pagination tuning — tiny pages + tiny DB batches
    const PAGE_SIZE = 30;     // keep very small
    const ROW_CHUNK = 30;     // upsert often
    const MAX_PAGES = 60;     // hard stop safety

    const baseHeaders = {
      'Cookie': `espn_s2=${espnS2Val}; SWID=${swidCookie}`, // espn_s2 first
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; GridironGM/1.0)',
      'Referer': 'https://fantasy.espn.com',
    };

    const filter = {
      players: {
        filterSlotIds: { value: [slotId] },
        filterStatsForExternalIds: { value: [season] },
        filterStatsForSourceIds: { value: [0, 1] }, // 0=actual, 1=projection
        filterStatsForTopScoringPeriodIds: { value: 2, additionalValue: [week] },
        sortAppliedStatTotal: { sortAsc: false, sortPriority: 1, value: 1027 },
      },
    };

    const playersUrl = (offset: number) =>
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/players` +
      `?scoringPeriodId=${week}&view=kona_player_info&limit=${PAGE_SIZE}&offset=${offset}`;

    let playersSeen = 0;
    let upserts = 0;
    let proj = 0;
    let actual = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE;

      let arr: any[] | null = null;
      try {
        const resp = await fetch(playersUrl(offset), {
          headers: { ...baseHeaders, 'X-Fantasy-Filter': JSON.stringify(filter) },
        });
        const contentType = resp.headers.get('content-type') || '';
        if (!resp.ok || !contentType.includes('application/json')) {
          break; // likely HTML/auth wall; stop
        }
        const parsed = await resp.json();
        arr = Array.isArray(parsed) ? parsed : null;
      } catch {
        arr = null;
      }

      if (!arr || arr.length === 0) break;
      playersSeen += arr.length;

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

          // Keep rows minimal to save memory
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

          if (s.statSourceId === 1) proj++; else actual++;

          if (buffer.length >= ROW_CHUNK) {
            const { error } = await supabase
              .from('player_pool')
              .upsert(buffer, { onConflict: 'league_id,season,week,player_id,source', ignoreDuplicates: false });
            if (error) throw error;
            upserts += buffer.length;
            buffer.length = 0;
            // tiny pause helps the GC on tight limits
            await sleep(0);
          }
        }

        // aggressively drop per-player references
        if (p.stats) delete p.stats;
        if (p.player?.stats) delete p.player.stats;
        arr[i] = null;
      }

      if (buffer.length) {
        const { error } = await supabase
          .from('player_pool')
          .upsert(buffer, { onConflict: 'league_id,season,week,player_id,source', ignoreDuplicates: false });
        if (error) throw error;
        upserts += buffer.length;
        buffer.length = 0;
      }

      // yield to GC between pages
      await sleep(0);

      if (arr.length < PAGE_SIZE) break;
    }

    const summary = {
      success: true,
      season,
      week,
      espn_league_id: espnLeagueId,
      slot: slotUpper,
      players_seen: playersSeen,
      inserted_or_updated: upserts,
      projections: proj,
      actuals: actual,
    };
    console.log('ingest summary', summary);

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in ingest-espn-by-slot:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});