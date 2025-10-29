import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const POSITION_MAP: Record<number, string> = { 1:'QB',2:'RB',3:'WR',4:'TE',5:'K',16:'DST' };
const TEAM_MAP: Record<number, string> = {
  1:'ATL',2:'BUF',3:'CHI',4:'CIN',5:'CLE',6:'DAL',7:'DEN',8:'DET',
  9:'GB',10:'TEN',11:'IND',12:'KC',13:'LV',14:'LAR',15:'MIA',
  16:'MIN',17:'NE',18:'NO',19:'NYG',20:'NYJ',21:'PHI',22:'ARI',
  23:'PIT',24:'LAC',25:'SF',26:'SEA',27:'TB',28:'WSH',29:'CAR',30:'JAX',33:'BAL',34:'HOU',
};

const getTeamAbbreviation = (id?: number) => TEAM_MAP[id as number] || 'FA';
const getPosition  = (id?: number) => POSITION_MAP[id as number] || 'FLEX';

function makeSlotFilter(season: number, week: number, slotId: number) {
  return {
    players: {
      filterSlotIds: { value: [slotId] },
      filterStatsForExternalIds: { value: [season] },
      filterStatsForSourceIds: { value: [0, 1] },
      filterStatsForTopScoringPeriodIds: { value: 2, additionalValue: [week] },
      sortAppliedStatTotal: { sortAsc: false, sortPriority: 1, value: 1027 },
    },
  };
}

function playersUrl(season: number, week: number, offset: number, pageSize: number) {
  return `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/players` +
         `?scoringPeriodId=${week}&view=kona_player_info&limit=${pageSize}&offset=${offset}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { leagueId, season, week: rawWeek, slotId, swid: bodySwid, espn_s2: bodyEspnS2 } = await req.json();
    const week = Number(rawWeek);
    if (!leagueId || !season || !week || typeof slotId !== 'number') {
      return new Response(JSON.stringify({ error: 'Missing leagueId, season, week, slotId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: leagueData, error: leagueError } = await supabase
      .from('connected_leagues')
      .select('league_id, id, user_id')
      .eq('id', leagueId)
      .single();
    if (leagueError || !leagueData) {
      return new Response(JSON.stringify({ error: 'League not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let swidVal: string | undefined = bodySwid;
    let espnS2Val: string | undefined = bodyEspnS2;
    if (!swidVal || !espnS2Val) {
      const { data: cred, error: credError } = await supabase
        .from('espn_credentials')
        .select('swid_encrypted, espn_s2_encrypted, expires_at')
        .eq('user_id', leagueData.user_id)
        .eq('league_id', leagueData.league_id)
        .maybeSingle();
      if (credError || !cred) {
        return new Response(JSON.stringify({ error: 'Missing ESPN credentials — please sign in with ESPN again.' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (!cred.expires_at || new Date(cred.expires_at) <= new Date()) {
        return new Response(JSON.stringify({ error: 'ESPN credentials expired — please sign in with ESPN again.' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      swidVal = cred.swid_encrypted;
      espnS2Val = cred.espn_s2_encrypted;
    }

    const swidCookie = swidVal!.startsWith('{') ? swidVal! : `{${swidVal}}`;

    const PAGE_SIZE = 80;
    const ROW_CHUNK = 40;
    const nowISO = new Date().toISOString();

    let totalSeen = 0, totalUpserts = 0, totalProj = 0, totalActual = 0;

    for (let offset = 0; ; offset += PAGE_SIZE) {
      const headers = {
        'Cookie': `espn_s2=${espnS2Val}; SWID=${swidCookie}`,
        'X-Fantasy-Filter': JSON.stringify(makeSlotFilter(season, week, slotId)),
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; GridironGM/1.0)',
        'Referer': 'https://fantasy.espn.com',
      };

      const resp = await fetch(playersUrl(season, week, offset, PAGE_SIZE), { headers });
      const text = await resp.text();
      if (!resp.ok || text.trim().startsWith('<') || text.includes('<html')) break;

      let page: any[];
      try { 
        const parsed = JSON.parse(text); 
        page = Array.isArray(parsed) ? parsed : []; 
      } catch { 
        break; 
      }

      if (!page || page.length === 0) break;
      totalSeen += page.length;

      let buffer: any[] = [];

      for (const p of page) {
        const espnId = p?.id?.toString(); 
        if (!espnId) continue;

        const name = p.fullName ?? p.player?.fullName ?? 'Unknown';
        const positionId = p.defaultPositionId ?? p.player?.defaultPositionId;
        const position = getPosition(positionId);
        const proTeamId = p.proTeamId ?? p.player?.proTeamId;
        const team = getTeamAbbreviation(proTeamId);

        const pdata = p.player ?? p;
        let waiver = 'ROSTERED';
        if (pdata.status === 'FREEAGENT') waiver = 'FREEAGENT';
        else if (pdata.status === 'WAIVERS') waiver = 'WAIVERS';

        const root = Array.isArray(p.stats) ? p.stats : [];
        const nested = Array.isArray(p.player?.stats) ? p.player.stats : [];
        const statsArr = root.length ? root : nested;
        if (!statsArr?.length) continue;

        for (const s of statsArr) {
          if (s.scoringPeriodId !== week) continue;
          if (s.statSourceId !== 0 && s.statSourceId !== 1) continue;

          const applied = s.appliedStats ?? s.stats ?? {};
          let fp = s.appliedTotal;
          if ((fp == null || Number.isNaN(fp)) && applied && Object.keys(applied).length) {
            fp = Object.values(applied).reduce((sum: number, v: any) =>
              sum + (typeof v === 'number' ? v : parseFloat(String(v)) || 0), 0);
          }
          if ((fp == null || fp === 0) && Object.keys(applied).length === 0) continue;

          buffer.push({
            league_id: leagueData.id,
            espn_league_id: leagueData.league_id,
            season, 
            week,
            player_id: `espn_${espnId}`,
            player_name: name,
            position, 
            team,
            waiver_status: waiver,
            source: s.statSourceId === 1 ? 'espn_projection' : 'espn_actual',
            projected_fp: fp || 0,
            provider_ids: { espn: espnId },
            percent_owned: p.ownership?.percentOwned || 0,
            percent_started: p.ownership?.percentStarted || 0,
            is_owned: waiver === 'ROSTERED',
            confidence: s.statSourceId === 1 ? 0.8 : 1.0,
            created_at: nowISO,
            updated_at: nowISO,
          });

          if (s.statSourceId === 1) totalProj++; else totalActual++;

          if (buffer.length >= ROW_CHUNK) {
            const { error } = await supabase
              .from('player_pool')
              .upsert(buffer, { onConflict: 'league_id,player_id,season,week', ignoreDuplicates: false });
            if (error) throw error;
            totalUpserts += buffer.length;
            buffer.length = 0;
          }
        }
      }

      if (buffer.length) {
        const { error } = await supabase
          .from('player_pool')
          .upsert(buffer, { onConflict: 'league_id,player_id,season,week', ignoreDuplicates: false });
        if (error) throw error;
        totalUpserts += buffer.length;
        buffer.length = 0;
      }

      await new Promise(r => setTimeout(r, 0));
    }

    return new Response(JSON.stringify({
      success: true,
      season, week, slotId,
      players_seen: totalSeen,
      inserted_or_updated: totalUpserts,
      projections: totalProj,
      actuals: totalActual,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
