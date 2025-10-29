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
        filterStatsForSourceIds: { value: [0, 1] }, // 0=actuals, 1=projections
        filterStatsForTopScoringPeriodIds: {
          value: [2],              // MUST be an array
          additionalValue: [week]  // MUST be an array
        },
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

    // Use view=kona_player_info&view=kona_playercard to get stats
    const espnUrlReads = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${espnLeagueId}?scoringPeriodId=${week}&view=kona_player_info&view=kona_playercard`;
    
    const headers = {
      'Cookie': `SWID=${swidCookie}; espn_s2=${espnS2Val}`,
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; GridironGM/1.0)',
    };

    const resp = await fetch(espnUrlReads, { headers });
    const text = await resp.text();
    const looksHtml = text.trim().startsWith('<') || text.includes('<html');

    if (!resp.ok || looksHtml) {
      console.error('ESPN returned non-JSON (status:', resp.status, '). First 300 chars:', text.substring(0, 300));
      return new Response(
        JSON.stringify({
          error: 'ESPN API error',
          status: resp.status,
          message: text.includes('messages') ? JSON.parse(text).messages?.[0] : 'Please reconnect your ESPN league.',
          debug: text.substring(0, 300)
        }),
        { status: resp.ok ? 401 : resp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let espnData: any;
    try {
      espnData = JSON.parse(text);
    } catch (e) {
      console.error('Failed to parse ESPN JSON:', (e as Error).message, text.substring(0, 200));
      return new Response(
        JSON.stringify({ error: 'Invalid JSON from ESPN', message: 'Please try again later.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const players = espnData.players || [];

    console.log(`Received ${players.length} players from ESPN`);
    
    // Debug: log first player structure to understand what we're getting
    if (players.length > 0) {
      const sample = players[0];
      console.log('Sample player structure:', JSON.stringify({
        id: sample.id,
        fullName: sample.fullName,
        hasStats: !!sample.stats,
        statsLength: sample.stats?.length || 0,
        firstStat: sample.stats?.[0] ? {
          scoringPeriodId: sample.stats[0].scoringPeriodId,
          statSourceId: sample.stats[0].statSourceId,
          hasAppliedTotal: !!sample.stats[0].appliedTotal
        } : null
      }, null, 2));
    }

    const poolRows: any[] = [];
    let projectionsCount = 0;
    let actualsCount = 0;
    let skippedNoStats = 0;
    let skippedWrongWeek = 0;

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
      
      if (statsArray.length === 0) {
        skippedNoStats++;
        continue;
      }
      
      for (const statEntry of statsArray) {
        if (statEntry.scoringPeriodId !== week) {
          skippedWrongWeek++;
          continue;
        }
        
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
    console.log(`Skipped: ${skippedNoStats} players with no stats, ${skippedWrongWeek} entries for wrong week`);

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
