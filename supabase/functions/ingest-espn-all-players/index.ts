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

    const { leagueId, season, week, swid: bodySwid, espn_s2: bodyEspnS2 } = await req.json();

    if (!leagueId || !season || !week) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: leagueId, season, week' }),
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
        filterStatsForSourceIds: { value: [0, 1] }, // Both actuals and projections
        filterStatsForTopScoringPeriodIds: { value: 2, additionalValue: [week] },
        limit: 5000,
        sortAppliedStatTotal: { 
          statSplitTypeId: 1, 
          sortAsc: false, 
          sortPriority: 1, 
          value: "1027" 
        },
      },
    };

    console.log(`Fetching all players for ESPN league ${espnLeagueId}, season ${season}, week ${week}`);

    const espnUrlReads = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${espnLeagueId}?scoringPeriodId=${week}&view=kona_player_info`;
    
    const headers = {
      'Cookie': `SWID=${swidCookie}; espn_s2=${espnS2Val}`,
      'X-Fantasy-Filter': JSON.stringify(filter),
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (compatible; GridironGM/1.0; +https://gtdataandinsights.com)',
      'Referer': 'https://fantasy.espn.com',
    };

    // Try multiple strategies to get JSON reliably
    const baseReads = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${espnLeagueId}`;
    const baseLegacy = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${espnLeagueId}`;

    const commonHeaders: Record<string, string> = {
      'Cookie': `SWID=${swidCookie}; espn_s2=${espnS2Val}`,
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (compatible; GridironGM/1.0; +https://gtdataandinsights.com)',
      'Referer': 'https://fantasy.espn.com',
      'X-Fantasy-Filter': JSON.stringify(filter),
      'X-Fantasy-Platform': 'kona',
    };

    let bodyText = '';
    let looksHtml = false;
    let espnResponse: Response | null = null;

    // Attempt 1: Reads host GET
    try {
      const url1 = `${baseReads}?scoringPeriodId=${week}&view=kona_player_info`;
      espnResponse = await fetch(url1, { headers: commonHeaders });
      bodyText = await espnResponse.text();
      looksHtml = bodyText.trim().startsWith('<!DOCTYPE html') || bodyText.includes('<html');
      if (espnResponse.ok && !looksHtml) {
        // success
      } else {
        console.warn('Reads GET did not return JSON (status:', espnResponse.status, ')');
        espnResponse = null;
      }
    } catch (e) {
      console.warn('Reads GET request failed:', (e as Error).message);
      espnResponse = null;
    }

    // Attempt 2: Reads host POST /players with JSON body
    if (!espnResponse) {
      try {
        const url2 = `${baseReads}/players?scoringPeriodId=${week}&view=kona_player_info`;
        const headers2 = { ...commonHeaders, 'Content-Type': 'application/json' };
        const resp2 = await fetch(url2, { method: 'POST', headers: headers2, body: JSON.stringify(filter) });
        const txt2 = await resp2.text();
        const html2 = txt2.trim().startsWith('<!DOCTYPE html') || txt2.includes('<html');
        if (resp2.ok && !html2) {
          espnResponse = resp2;
          bodyText = txt2;
        } else {
          console.warn('Reads POST /players did not return JSON (status:', resp2.status, ')');
        }
      } catch (e) {
        console.warn('Reads POST /players failed:', (e as Error).message);
      }
    }

    // Attempt 3: Legacy host GET
    if (!espnResponse) {
      try {
        const url3 = `${baseLegacy}?scoringPeriodId=${week}&view=kona_player_info`;
        const resp3 = await fetch(url3, { headers: commonHeaders });
        const txt3 = await resp3.text();
        const html3 = txt3.trim().startsWith('<!DOCTYPE html') || txt3.includes('<html');
        if (resp3.ok && !html3) {
          espnResponse = resp3;
          bodyText = txt3;
        } else {
          console.warn('Legacy GET did not return JSON (status:', resp3.status, ')');
        }
      } catch (e) {
        console.warn('Legacy GET request failed:', (e as Error).message);
      }
    }

    // Attempt 4: Legacy host POST /players
    if (!espnResponse) {
      try {
        const url4 = `${baseLegacy}/players?scoringPeriodId=${week}&view=kona_player_info`;
        const headers4 = { ...commonHeaders, 'Content-Type': 'application/json' };
        const resp4 = await fetch(url4, { method: 'POST', headers: headers4, body: JSON.stringify(filter) });
        const txt4 = await resp4.text();
        const html4 = txt4.trim().startsWith('<!DOCTYPE html') || txt4.includes('<html');
        if (resp4.ok && !html4) {
          espnResponse = resp4;
          bodyText = txt4;
        } else {
          console.error('Legacy POST /players also failed (status:', resp4.status, '). First 200 chars:', txt4.substring(0, 200));
        }
      } catch (e) {
        console.error('Legacy POST /players failed:', (e as Error).message);
      }
    }

    if (!espnResponse) {
      return new Response(
        JSON.stringify({
          error: 'ESPN returned non-JSON (likely auth/expired cookies)',
          status: 401,
          message: 'Please reconnect your ESPN league (SWID/espn_s2 may be expired).',
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // We have JSON now
    let espnData: any;
    try {
      espnData = JSON.parse(bodyText);
    } catch (e) {
      console.error('Failed to parse ESPN JSON:', (e as Error).message, bodyText.substring(0, 200));
      return new Response(
        JSON.stringify({ error: 'Invalid JSON from ESPN', message: 'Please try again later.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const players = espnData.players || [];

    console.log(`Received ${players.length} players from ESPN`);

    const poolRows: any[] = [];
    let projectionsCount = 0;
    let actualsCount = 0;

    for (const player of players) {
      const espnId = player.id?.toString();
      if (!espnId) continue;

      const playerName = player.fullName || player.player?.fullName || 'Unknown';
      const positionId = player.defaultPositionId || player.player?.defaultPositionId;
      const position = getPosition(positionId);
      const proTeamId = player.proTeamId || player.player?.proTeamId;
      const team = getTeamAbbreviation(proTeamId);
      
      // Determine waiver status
      const ownership = player.ownership || {};
      const playerData = player.player || player;
      let waiverStatus = 'ROSTERED';
      if (playerData.status === 'FREEAGENT') waiverStatus = 'FREEAGENT';
      else if (playerData.status === 'WAIVERS') waiverStatus = 'WAIVERS';

      // Process both projection and actual stats for this player
      const statsArray = player.stats || [];
      
      for (const statEntry of statsArray) {
        if (statEntry.scoringPeriodId !== week) continue;
        
        const sourceId = statEntry.statSourceId;
        const sourceType = sourceId === 1 ? 'projection' : sourceId === 0 ? 'actual' : null;
        if (!sourceType) continue;

        const appliedStats = statEntry.appliedStats || {};
        let appliedTotal = statEntry.appliedTotal;
        
        // Compute appliedTotal if missing
        if (appliedTotal == null && Object.keys(appliedStats).length > 0) {
          appliedTotal = Object.values(appliedStats).reduce(
            (sum: number, val: any) => sum + (typeof val === 'number' ? val : parseFloat(val || '0') || 0),
            0
          );
        }

        // Skip if no stats available
        if ((appliedTotal == null || appliedTotal === 0) && Object.keys(appliedStats).length === 0) {
          continue;
        }

        const row = {
          league_id: leagueData.id,
          espn_league_id: espnLeagueId,
          season,
          week,
          player_id: `espn_${espnId}`,
          player_name: playerName,
          position,
          team,
          waiver_status: waiverStatus,
          source: sourceType === 'projection' ? 'espn_projection' : 'espn_actual',
          projected_fp: appliedTotal || 0,
          stats: statEntry.stats || {},
          applied_breakdown: appliedStats,
          provider_ids: { espn: espnId },
          percent_owned: ownership.percentOwned || 0,
          percent_started: ownership.percentStarted || 0,
          is_owned: waiverStatus === 'ROSTERED',
          confidence: sourceType === 'projection' ? 0.8 : 1.0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        poolRows.push(row);
        
        if (sourceType === 'projection') projectionsCount++;
        else actualsCount++;
      }
    }

    console.log(`Parsed ${poolRows.length} total rows (${projectionsCount} projections, ${actualsCount} actuals)`);

    // Upsert to player_pool in chunks
    if (poolRows.length > 0) {
      const chunkSize = 500;
      for (let i = 0; i < poolRows.length; i += chunkSize) {
        const chunk = poolRows.slice(i, i + chunkSize);
        const { error: upsertError } = await supabase
          .from('player_pool')
          .upsert(chunk, {
            onConflict: 'league_id,season,week,player_id,source',
            ignoreDuplicates: false,
          });

        if (upsertError) {
          console.error(`Error upserting chunk ${i / chunkSize + 1}:`, upsertError);
          throw upsertError;
        }
      }
    }

    const summary = {
      success: true,
      season,
      week,
      players_seen: players.length,
      inserted_or_updated: poolRows.length,
      projections: projectionsCount,
      actuals: actualsCount,
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
