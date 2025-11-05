import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    const { season = 2025, week } = await req.json();

    console.log(`Computing defensive rankings for season ${season}${week ? `, week ${week}` : ''}`);

    // Prepare to fetch stats efficiently and avoid 1000-row default limits
    const positions = ['QB', 'RB', 'WR', 'TE'];

    // Determine which weeks to process
    let weeks: number[] = [];
    if (week) {
      weeks = [week];
    } else {
      // Use team_schedules to get distinct weeks to avoid 1,000 row limits on stats
      const { data: weeksData, error: weeksError } = await supabase
        .from('team_schedules')
        .select('week')
        .eq('season', season)
        .order('week')
        .limit(1000);
      if (weeksError) throw weeksError;
      weeks = [...new Set((weeksData || []).map((w: any) => w.week).filter((w: number) => typeof w === 'number'))];
    }

    console.log(`Will process ${weeks.length} week(s): [${weeks.join(', ')}]`);

    console.log(`Will process ${weeks.length} week(s): [${weeks.join(', ')}]`);

    // Group stats by opponent (defense), position, AND week for per-week rankings
    interface DefensiveStat {
      team: string;
      week: number;
      season: number;
      position: string;
      fantasy_points_allowed: number;
      yards_allowed: number;
      tds_allowed: number;
      games_played: number;
      avg_points_allowed: number;
    }

    const defensiveStats: Record<string, DefensiveStat> = {};

    for (const currentWeek of weeks) {
      const { data: weekStats, error: statsError } = await supabase
        .from('nfl_fantasy_points')
        .select('*')
        .eq('season', season)
        .eq('week', currentWeek)
        .in('position', positions)
        .not('opponent', 'is', null)
        .limit(10000);

      if (statsError) throw statsError;
      console.log(`Week ${currentWeek}: processing ${weekStats?.length || 0} player stat records`);

      (weekStats || []).forEach((stat: any) => {
        const opponent = stat.opponent as string | null;
        const position = stat.position as string | null;
        if (!opponent || !position || !positions.includes(position)) return;

        // Create per-week defensive stats (one record per defense-position-week)
        const key = `${opponent}_${position}_${currentWeek}`;
        if (!defensiveStats[key]) {
          defensiveStats[key] = {
            team: opponent,
            week: currentWeek,
            season: season,
            position: position,
            fantasy_points_allowed: 0,
            yards_allowed: 0,
            tds_allowed: 0,
            // For per-week entries, each defense plays one game
            games_played: 1,
            avg_points_allowed: 0,
          };
        }

        defensiveStats[key].fantasy_points_allowed += stat.fantasy_points_ppr || 0;
        defensiveStats[key].yards_allowed += (stat.passing_yards || 0) + (stat.rushing_yards || 0) + (stat.receiving_yards || 0);
        defensiveStats[key].tds_allowed += (stat.passing_tds || 0) + (stat.rushing_tds || 0) + (stat.receiving_tds || 0);
      });
    }

    // Calculate averages (per-week entries: avg == total allowed that week)
    const defensiveRankings = Object.values(defensiveStats).map(stat => ({
      ...stat,
      avg_points_allowed: stat.fantasy_points_allowed,
    }));


    console.log(`Created ${defensiveRankings.length} defensive stat entries`);

    // Calculate rankings BEFORE inserting (1 = hardest defense/fewest points, 32 = easiest/most points)
    const uniqueWeeks = [...new Set(defensiveRankings.map(r => r.week))];
    const rankingsWithRank: Array<DefensiveStat & { rank: number }> = [];
    
    for (const position of positions) {
      for (const currentWeek of uniqueWeeks) {
        const weekPositionStats = defensiveRankings
          .filter(s => s.position === position && s.week === currentWeek)
          .sort((a, b) => a.avg_points_allowed - b.avg_points_allowed); // Ascending: fewest points = rank 1

        weekPositionStats.forEach((stat, index) => {
          rankingsWithRank.push({
            ...stat,
            rank: index + 1
          });
        });
      }
    }

    console.log(`Calculated ranks for ${rankingsWithRank.length} entries`);

    // Upsert defensive rankings with ranks already calculated
    const { error: upsertError } = await supabase
      .from('defensive_rankings')
      .upsert(rankingsWithRank, {
        onConflict: 'team,week,season,position',
      });

    if (upsertError) {
      console.error('Upsert error:', upsertError);
      throw upsertError;
    }

    console.log('Successfully upserted defensive rankings');

    // Now compute strength of schedule - per-game rows using defensive rankings (defense-centric)
    const { data: schedules, error: schedError } = await supabase
      .from('team_schedules')
      .select('*')
      .eq('season', season)
      .order('week');

    if (schedError) throw schedError;

    console.log(`Processing ${schedules.length} schedule entries for per-week SOS`);

    // Build a fast lookup: defense (team) + position + week -> { avg_points_allowed, rank }
    const rankingMap = new Map<string, { avg: number; rank: number }>();
    for (const r of rankingsWithRank) {
      const key = `${r.team}_${r.position}_${r.week}`;
      rankingMap.set(key, { avg: r.avg_points_allowed, rank: r.rank });
    }

    interface SOSEntry {
      team: string;
      week: number | null;
      season: number;
      opponent: string | null;
      [key: string]: any;
    }

    const sosRows: SOSEntry[] = [];

    // For each scheduled game, copy the defense's (team) weekly points allowed and rank per position
    for (const match of schedules) {
      const row: SOSEntry = {
        team: match.team,
        opponent: match.opponent ?? null,
        week: match.week ?? null,
        season: season,
      };

      for (const position of positions) {
        const posKey = position.toLowerCase();
        const key = `${match.team}_${position}_${match.week}`; // Defense is the schedule.team
        const val = rankingMap.get(key);
        row[`avg_points_allowed_${posKey}`] = val ? val.avg : 0;
        row[`def_rank_${posKey}`] = val ? val.rank : null;
      }

      sosRows.push(row);
    }

    console.log(`Prepared ${sosRows.length} per-week SOS rows. Clearing existing rows for season ${season}...`);

    // Replace existing rows for the season to avoid duplicates
    const { error: deleteError } = await supabase
      .from('strength_of_schedule')
      .delete()
      .eq('season', season);

    if (deleteError) {
      console.error('Failed to clear existing SOS rows:', deleteError);
      throw deleteError;
    }

    // Insert per-week SOS rows (team, opponent, week, season)
    const { error: insertError } = await supabase
      .from('strength_of_schedule')
      .insert(sosRows);

    if (insertError) {
      console.error('SOS insert error:', insertError);
      throw insertError;
    }

    console.log('Successfully inserted per-week strength of schedule rows');

    return new Response(
      JSON.stringify({
        success: true,
        message: `Computed defensive rankings and SOS for ${rankingsWithRank.length} defensive entries`,
        defensiveRankings: rankingsWithRank.length,
        sosEntries: sosRows.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error computing defensive rankings:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});