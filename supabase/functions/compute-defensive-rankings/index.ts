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

    // Get all player stats with opponent data
    const { data: playerStats, error: statsError } = await supabase
      .from('nfl_fantasy_points')
      .select('*')
      .eq('season', season)
      .not('opponent', 'is', null);

    if (statsError) throw statsError;

    // Group stats by opponent (defense) and position
    interface DefensiveStat {
      team: string;
      week: number;
      season: number;
      position: string;
      fantasy_points_allowed: number;
      yards_allowed: number;
      tds_allowed: number;
      games_played: number;
    }

    const defensiveStats: Record<string, DefensiveStat> = {};
    const positions = ['QB', 'RB', 'WR', 'TE'];

    playerStats.forEach(stat => {
      const opponent = stat.opponent;
      const position = stat.position;
      
      if (!opponent || !positions.includes(position)) return;

      const key = `${opponent}_${position}_${stat.week}`;
      
      if (!defensiveStats[key]) {
        defensiveStats[key] = {
          team: opponent,
          week: stat.week,
          season: season,
          position: position,
          fantasy_points_allowed: 0,
          yards_allowed: 0,
          tds_allowed: 0,
          games_played: 0,
        };
      }

      defensiveStats[key].fantasy_points_allowed += stat.fantasy_points_ppr || 0;
      defensiveStats[key].yards_allowed += (stat.passing_yards || 0) + (stat.rushing_yards || 0) + (stat.receiving_yards || 0);
      defensiveStats[key].tds_allowed += (stat.passing_tds || 0) + (stat.rushing_tds || 0) + (stat.receiving_tds || 0);
      defensiveStats[key].games_played = 1;
    });

    // Calculate averages and prepare for insert
    const defensiveRankings = Object.values(defensiveStats).map(stat => ({
      ...stat,
      avg_points_allowed: stat.fantasy_points_allowed / stat.games_played,
    }));

    // Upsert defensive rankings
    const { error: upsertError } = await supabase
      .from('defensive_rankings')
      .upsert(defensiveRankings, {
        onConflict: 'team,week,season,position',
      });

    if (upsertError) throw upsertError;

    // Calculate rankings (1 = easiest, 32 = hardest) for each position
    for (const position of positions) {
      const positionStats = defensiveRankings
        .filter(s => s.position === position)
        .sort((a, b) => b.avg_points_allowed - a.avg_points_allowed);

      for (let i = 0; i < positionStats.length; i++) {
        const { error: rankError } = await supabase
          .from('defensive_rankings')
          .update({ rank: i + 1 })
          .eq('team', positionStats[i].team)
          .eq('week', positionStats[i].week)
          .eq('season', positionStats[i].season)
          .eq('position', position);

        if (rankError) throw rankError;
      }
    }

    // Now compute strength of schedule
    const { data: schedules, error: schedError } = await supabase
      .from('team_schedules')
      .select('*')
      .eq('season', season);

    if (schedError) throw schedError;

    const sosData = [];

    for (const schedule of schedules) {
      const sosEntry: any = {
        team: schedule.team,
        week: schedule.week,
        season: season,
        opponent: schedule.opponent,
      };

      // Get defensive rankings for opponent
      for (const position of positions) {
        const { data: defRank } = await supabase
          .from('defensive_rankings')
          .select('rank, avg_points_allowed')
          .eq('team', schedule.opponent)
          .eq('season', season)
          .eq('position', position)
          .maybeSingle();

        const posKey = position.toLowerCase();
        sosEntry[`def_rank_${posKey}`] = defRank?.rank || null;
        sosEntry[`avg_points_allowed_${posKey}`] = defRank?.avg_points_allowed || 0;
      }

      sosData.push(sosEntry);
    }

    // Upsert strength of schedule
    const { error: sosError } = await supabase
      .from('strength_of_schedule')
      .upsert(sosData, {
        onConflict: 'team,week,season',
      });

    if (sosError) throw sosError;

    return new Response(
      JSON.stringify({
        success: true,
        message: `Computed defensive rankings and SOS for ${defensiveRankings.length} entries`,
        defensiveRankings: defensiveRankings.length,
        sosEntries: sosData.length,
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