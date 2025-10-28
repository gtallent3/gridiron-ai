import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const requestSchema = z.object({
  leagueId: z.string(),
  season: z.number().int(),
  week: z.number().int().min(1).max(18),
  swid: z.string(),
  espn_s2: z.string(),
});

const POSITION_MAP: { [key: number]: string } = {
  1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json();
    const { leagueId, season, week, swid, espn_s2 } = requestSchema.parse(body);

    console.log(`Ingesting ESPN waiver actuals: League ${leagueId}, Season ${season}, Week ${week}`);

    const filter = {
      players: {
        filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
        filterStatsForExternalIds: { value: [season] },
        filterStatsForSourceIds: { value: [0] }, // 0 = actuals
        filterStatsForTopScoringPeriodIds: {
          value: 2,
          additionalValue: [week]
        },
        limit: 2000,
        sortPercOwned: { sortPriority: 1, sortAsc: false }
      }
    };

    const url = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?scoringPeriodId=${week}&view=kona_player_info`;
    
    const response = await fetch(url, {
      headers: {
        'Cookie': `SWID=${swid}; espn_s2=${espn_s2}`,
        'X-Fantasy-Filter': JSON.stringify(filter),
      },
    });

    if (!response.ok) {
      throw new Error(`ESPN API error: ${response.status}`);
    }

    const data = await response.json();
    const players = data.players || [];

    console.log(`Week ${week}: Found ${players.length} waiver/FA players with actuals`);

    let totalInserted = 0;

    // Process each player
    for (const playerData of players) {
      const player = playerData.player;
      if (!player) continue;

      const espnId = player.id.toString();
      const playerName = player.fullName;
      const positionId = player.defaultPositionId;
      const position = POSITION_MAP[positionId] || 'FLEX';
      const team = player.proTeamId ? `TEAM_${player.proTeamId}` : null;
      
      const ownership = playerData.ownership || {};
      const percentOwned = ownership.percentOwned || 0;
      const percentStarted = ownership.percentStarted || 0;

      // Determine waiver status
      const waiverStatus = playerData.status === 'FREEAGENT' ? 'FREEAGENT' : 'WAIVERS';

      // Find actual stats for this week
      const playerStats = player.stats || [];
      const actualStat = playerStats.find((s: any) => 
        s.scoringPeriodId === week && 
        s.statSourceId === 0 && // actuals
        s.seasonId === season
      );

      if (!actualStat) {
        console.log(`No actuals found for ${playerName} week ${week}`);
        continue;
      }

      const rawStats = actualStat.stats || {};

      // Build normalized stats structure
      const stats: any = {
        passing_yards: rawStats['3'] || 0,
        passing_tds: rawStats['4'] || 0,
        passing_attempts: rawStats['0'] || 0,
        passing_completions: rawStats['1'] || 0,
        interceptions: rawStats['20'] || 0,
        passing_2pt_conversions: rawStats['19'] || 0,
        rushing_yards: rawStats['24'] || 0,
        rushing_tds: rawStats['25'] || 0,
        rushing_attempts: rawStats['23'] || 0,
        rushing_2pt_conversions: rawStats['29'] || 0,
        receptions: rawStats['53'] || 0,
        receiving_yards: rawStats['42'] || 0,
        receiving_tds: rawStats['43'] || 0,
        receiving_targets: rawStats['58'] || 0,
        receiving_2pt_conversions: rawStats['49'] || 0,
        fumbles_lost: rawStats['72'] || 0,
      };

      // For kickers
      if (position === 'K') {
        stats.fg_made_0_19 = rawStats['80'] || 0;
        stats.fg_made_20_29 = rawStats['81'] || 0;
        stats.fg_made_30_39 = rawStats['82'] || 0;
        stats.fg_made_40_49 = rawStats['83'] || 0;
        stats.fg_made_50_plus = rawStats['84'] || 0;
        stats.xp_made = rawStats['86'] || 0;
      }

      const statusFlags = {
        injury_status: player.injuryStatus || null,
      };

      // Upsert to normalized_players
      await supabase
        .from('normalized_players')
        .upsert({
          player_id: espnId,
          player_name: playerName,
          position,
          team,
          espn_id: espnId,
          stats: {},
        }, { 
          onConflict: 'player_id',
          ignoreDuplicates: false 
        });

      // Upsert to player_stats
      const { error: insertError } = await supabase
        .from('player_stats')
        .upsert({
          player_id: espnId,
          player_name: playerName,
          team,
          position,
          season,
          week,
          source: 'espn_actual',
          source_type: 'actual',
          stats,
          waiver_status: waiverStatus,
          percent_owned: percentOwned,
          percent_started: percentStarted,
          provider_ids: { espn: espnId },
          freshness_ts: new Date().toISOString(),
          confidence: 1.0,
          finalized: true,
        }, {
          onConflict: 'player_id,season,week,source',
          ignoreDuplicates: false
        });

      if (insertError) {
        console.error(`Error inserting ${playerName}:`, insertError);
      } else {
        totalInserted++;
      }
    }

    console.log(`Completed: ${totalInserted} players ingested`);

    return new Response(
      JSON.stringify({
        success: true,
        season,
        week,
        playersIngested: totalInserted,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in ingest-espn-waiver-actuals:', error);
    
    if (error instanceof z.ZodError) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid request parameters',
          details: error.errors,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
