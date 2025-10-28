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
  startWeek: z.number().int().min(1).max(18),
  endWeek: z.number().int().min(1).max(18),
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
    const { leagueId, season, startWeek, endWeek, swid, espn_s2 } = requestSchema.parse(body);

    console.log(`Ingesting ESPN waiver projections: League ${leagueId}, Season ${season}, Weeks ${startWeek}-${endWeek}`);

    let totalInserted = 0;
    let totalUpdated = 0;

    // Ensure SWID has braces
    const swidCookie = swid?.startsWith('{') ? swid : `{${swid}}`;

    // Process each week
    for (let week = startWeek; week <= endWeek; week++) {
      const filter = {
        players: {
          filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
          filterStatsForExternalIds: { value: [season] },
          filterStatsForSourceIds: { value: [1] }, // 1 = projections
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
          'Cookie': `SWID=${swidCookie}; espn_s2=${espn_s2}`,
          'X-Fantasy-Filter': JSON.stringify(filter),
        },
      });

      if (!response.ok) {
        console.error(`ESPN API error for week ${week}: ${response.status}`);
        continue;
      }

      const data = await response.json();
      const players = data.players || [];

      console.log(`Week ${week}: Found ${players.length} waiver/FA players`);

      // Process each player
      for (const playerData of players) {
        const player = playerData.player;
        if (!player) continue;

        const espnId = player.id.toString();
        const canonicalId = `espn_${espnId}`;
        const playerName = player.fullName;
        const positionId = player.defaultPositionId;
        const position = POSITION_MAP[positionId] || 'FLEX';
        const team = player.proTeamId ? `TEAM_${player.proTeamId}` : null;
        
        const ownership = playerData.ownership || {};
        const percentOwned = ownership.percentOwned || 0;
        const percentStarted = ownership.percentStarted || 0;

        // Determine waiver status
        const waiverStatus = playerData.status === 'FREEAGENT' ? 'FREEAGENT' : 'WAIVERS';

        // Find projection stats for this week
        const playerStats = player.stats || [];
        const projectionStat = playerStats.find((s: any) => 
          s.scoringPeriodId === week && 
          s.statSourceId === 1 && // projections
          s.seasonId === season
        );

        if (!projectionStat) {
          console.log(`No projection found for ${playerName} week ${week}`);
          continue;
        }

        const appliedTotal = projectionStat.appliedTotal || 0;
        const appliedStats = projectionStat.appliedStats || {};
        const rawStats = projectionStat.stats || {};

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

        // For kickers and DST, rely on applied stats
        if (position === 'K') {
          stats.fg_made_0_19 = rawStats['80'] || 0;
          stats.fg_made_20_29 = rawStats['81'] || 0;
          stats.fg_made_30_39 = rawStats['82'] || 0;
          stats.fg_made_40_49 = rawStats['83'] || 0;
          stats.fg_made_50_plus = rawStats['84'] || 0;
          stats.xp_made = rawStats['86'] || 0;
        }

        // Check for bye week
        const isBye = appliedTotal === 0 && Object.keys(rawStats).length === 0;
        const statusFlags = {
          is_bye: isBye,
          injury_status: player.injuryStatus || null,
        };

        // Upsert to normalized_players
        const { data: normalizedPlayer } = await supabase
          .from('normalized_players')
          .upsert({
            player_id: canonicalId,
            player_name: playerName,
            position,
            team,
            espn_id: espnId,
            stats: {},
          }, { 
            onConflict: 'player_id',
            ignoreDuplicates: false 
          })
          .select()
          .single();

        // Upsert to projected_player_stats
        const { error: insertError } = await supabase
          .from('projected_player_stats')
          .upsert({
            player_id: canonicalId,
            player_name: playerName,
            team,
            position,
            season,
            week,
            source: 'espn_projection',
            stats,
            status_flags: statusFlags,
            confidence: isBye ? 0 : 0.8,
            waiver_status: waiverStatus,
            percent_owned: percentOwned,
            percent_started: percentStarted,
            projected_fp: appliedTotal,
            applied_breakdown: appliedStats,
            provider_ids: { espn: espnId },
            last_updated: new Date().toISOString(),
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
    }

    console.log(`Completed: ${totalInserted} players ingested`);

    return new Response(
      JSON.stringify({
        success: true,
        season,
        weeks: `${startWeek}-${endWeek}`,
        playersIngested: totalInserted,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in ingest-espn-waiver-projections:', error);
    
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
