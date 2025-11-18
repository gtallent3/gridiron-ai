// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** ESPN slotId map (players endpoint) */
const SLOT_NAME_TO_ID: Record<string, number> = {
  QB: 0, RB: 2, WR: 4, TE: 6, K: 17, DST: 16,
};
type SlotName = keyof typeof SLOT_NAME_TO_ID;

/** Default counts per team */
const DEFAULT_COUNTS: Record<SlotName, number> = {
  QB: 2, RB: 5, WR: 10, TE: 4, K: 1, DST: 1,
};

/** Position ID to display label on row */
const POSITION_MAP: Record<number, string> = {
  1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST',
};

/** ESPN proTeamId -> NFL abbrev */
const TEAM_MAP: Record<number, string> = {
  1:'ATL',2:'BUF',3:'CHI',4:'CIN',5:'CLE',6:'DAL',7:'DEN',8:'DET',
  9:'GB',10:'TEN',11:'IND',12:'KC',13:'LV',14:'LAR',15:'MIA',
  16:'MIN',17:'NE',18:'NO',19:'NYG',20:'NYJ',21:'PHI',22:'ARI',
  23:'PIT',24:'LAC',25:'SF',26:'SEA',27:'TB',28:'WSH',
  29:'CAR',30:'JAX',33:'BAL',34:'HOU',
};
const PRO_TEAM_IDS = Object.keys(TEAM_MAP).map((k) => Number(k)); // [1,2,...,34]

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

type CountsOverride = Partial<Record<SlotName, number>>;

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
    const {
      leagueId,
      season,
      week: rawWeek,
      swid: bodySwid,
      espn_s2: bodyEspnS2,
      counts: countsOverride,    // optional: { QB?:number, RB?:number, ... }
      teams: teamIdsOverride,    // optional: number[] of ESPN proTeamIds to restrict
      slots: slotsOverride,      // optional: string[] subset of ["QB","RB","WR","TE","K","DST"]
      slot: singleSlot,          // NEW: single slot string for processing one position
    }: {
      leagueId: string;
      season: number;
      week: number | string;
      swid?: string;
      espn_s2?: string;
      counts?: CountsOverride;
      teams?: number[];
      slots?: SlotName[];
      slot?: string;
    } = body ?? {};

    const week = Number(rawWeek);
    if (!leagueId || !season || !week) {
      return new Response(JSON.stringify({ error: 'Missing required parameters: leagueId, season, week' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    /** Counts to use */
    const COUNTS: Record<SlotName, number> = { ...DEFAULT_COUNTS };
    if (countsOverride) {
      Object.entries(countsOverride).forEach(([key, value]) => {
        if (value !== undefined) {
          COUNTS[key as SlotName] = value;
        }
      });
    }

    /** Slots list to process - prioritize single slot if provided */
    let SLOTS: SlotName[];
    if (singleSlot && singleSlot in SLOT_NAME_TO_ID) {
      SLOTS = [singleSlot as SlotName];
    } else if (Array.isArray(slotsOverride) && slotsOverride.length) {
      SLOTS = slotsOverride.filter((s): s is SlotName => s in SLOT_NAME_TO_ID);
    } else {
      SLOTS = (Object.keys(SLOT_NAME_TO_ID) as SlotName[]);
    }

    /** Teams list to process */
    const TEAMS = Array.isArray(teamIdsOverride) && teamIdsOverride.length
      ? teamIdsOverride.filter((t) => TEAM_MAP[t])
      : PRO_TEAM_IDS;

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

    // Resolve credentials (prefer body, fallback to stored & check expiry)
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

    // ESPN requests config (small pages, GC-friendly)
    const PAGE_SIZE = 25;  // per team/slot the set is small; 25 is enough in practice
    const ROW_CHUNK = 25;  // upsert per team after selection
    const MAX_PAGES = 4;   // safety bound

    const baseHeaders = {
      'Cookie': `espn_s2=${espnS2Val}; SWID=${swidCookie}`, // espn_s2 first to avoid rare flakiness
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; GridironGM/1.0)',
      'Referer': 'https://fantasy.espn.com',
    };

    const playersUrl = (offset: number) =>
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/players` +
      `?scoringPeriodId=${week}&view=kona_player_info&limit=${PAGE_SIZE}&offset=${offset}`;

    /** Build filter per team+slot */
    const makeFilter = (slotId: number, proTeamId: number) => ({
      players: {
        filterSlotIds: { value: [slotId] },
        filterProTeamIds: { value: [proTeamId] },
        filterStatsForExternalIds: { value: [season] },
        filterStatsForSourceIds: { value: [1] }, // projections only for selection
        filterStatsForTopScoringPeriodIds: { value: 2, additionalValue: [week] },
        sortAppliedStatTotal: { sortAsc: false, sortPriority: 1, value: 1027 }, // numeric 1027
      },
    });

    async function fetchTeamSlotCandidates(proTeamId: number, slotName: SlotName) {
      const slotId = SLOT_NAME_TO_ID[slotName];
      const candidates: Array<{
        id: string;
        name: string;
        position: string;
        proTeamId: number;
        proj: number;
        depth: number | null;
        status: string;
        percentOwned: number;
        percentStarted: number;
      }> = [];

      for (let page = 0; page < MAX_PAGES; page++) {
        const offset = page * PAGE_SIZE;
        const filter = makeFilter(slotId, proTeamId);

        let arr: any[] | null = null;
        try {
          const resp = await fetch(playersUrl(offset), {
            headers: { ...baseHeaders, 'X-Fantasy-Filter': JSON.stringify(filter) },
          });
          const contentType = resp.headers.get('content-type') || '';
          if (!resp.ok || !contentType.includes('application/json')) break;
          const parsed = await resp.json();
          arr = Array.isArray(parsed) ? parsed : null;
        } catch {
          arr = null;
        }
        if (!arr || arr.length === 0) break;

        for (const p of arr) {
          const stats = Array.isArray(p.stats) ? p.stats : (Array.isArray(p.player?.stats) ? p.player.stats : []);
          if (!stats?.length) continue;
          const projEntry = stats.find((s: any) => s.statSourceId === 1 && s.scoringPeriodId === week);
          if (!projEntry) continue;

          const applied = projEntry.appliedStats ?? projEntry.stats ?? {};
          const proj = computeAppliedTotal(applied, projEntry.appliedTotal) || 0;

          const name = p.fullName ?? p.player?.fullName ?? 'Unknown';
          const position = getPosition(p.defaultPositionId ?? p.player?.defaultPositionId);
          const proTid = p.proTeamId ?? p.player?.proTeamId ?? proTeamId;
          const id = String(p?.id ?? p.player?.id ?? '');
          const status = (p.player?.status ?? p.status) || '';
          const percentOwned = p.ownership?.percentOwned ?? 0;
          const percentStarted = p.ownership?.percentStarted ?? 0;
          const depth = (p.player?.depthChartOrder ?? p.depthChartOrder ?? null);

          candidates.push({ id, name, position, proTeamId: proTid, proj, depth: typeof depth === 'number' ? depth : null, status, percentOwned, percentStarted });
        }

        // small yield helps GC
        await sleep(0);

        if (arr.length < PAGE_SIZE) break;
      }

      return candidates;
    }

    function rankAndPick(candidates: any[], n: number) {
      const picked = [...candidates].sort((a, b) => {
        if (b.proj !== a.proj) return b.proj - a.proj;
        const ad = a.depth ?? 99;
        const bd = b.depth ?? 99;
        if (ad !== bd) return ad - bd;
        return (a.name ?? '').localeCompare(b.name ?? '');
      }).slice(0, n);
      return picked;
    }

    let totalSelected = 0;
    let totalUpserts = 0;

    for (const teamId of TEAMS) {
      for (const slot of SLOTS) {
        const want = COUNTS[slot] ?? 0;
        if (want <= 0) continue;

        const teamAbbrev = getTeamAbbreviation(teamId);
        // Pull candidates
        const cands = await fetchTeamSlotCandidates(teamId, slot);

        if (!cands.length) continue;

        const chosen = rankAndPick(cands, want);

        const rows = chosen.map((c: any, idx: number) => {
          return {
            league_id: leagueData.id,
            espn_league_id: espnLeagueId,
            season,
            week,
            player_id: `espn_${c.id}`,
            player_name: c.name,
            position: c.position,
            team: getTeamAbbreviation(c.proTeamId),
            waiver_status: c.status === 'FREEAGENT' ? 'FREEAGENT' : (c.status === 'WAIVERS' ? 'WAIVERS' : 'ROSTERED'),
            source: 'espn_projection',
            projected_fp: c.proj || 0,
            percent_owned: c.percentOwned,
            percent_started: c.percentStarted,
            is_owned: (c.status !== 'FREEAGENT' && c.status !== 'WAIVERS'),
            confidence: 0.8,
            selection_rank: idx + 1,
            selection_reason: `top_${want}_by_projection_in_team_${teamAbbrev}_${slot}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
        });

        if (rows.length) {
          // Note: player_pool table was removed - data stored in projected_player_stats instead
          totalSelected += rows.length;
        }

        // Yield to GC between team/slot
        await sleep(0);
      }
    }

    const summary = {
      success: true,
      season,
      week,
      espn_league_id: espnLeagueId,
      teams_processed: TEAMS.length,
      slots_processed: SLOTS,
      selected_and_upserted: totalSelected,
      upsert_ops: totalUpserts,
      strategy: 'per-team top-N by projection; tie-break depth chart',
    };
    console.log('ingest summary', summary);

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in ingest-espn-top-by-team:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
