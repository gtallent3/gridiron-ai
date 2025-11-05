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

    console.log(`Processing ${playerStats.length} player stat records`);

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
    const positions = ['QB', 'RB', 'WR', 'TE'];

    playerStats.forEach(stat => {
      const opponent = stat.opponent;
      const position = stat.position;
      
      if (!opponent || !positions.includes(position)) return;

      // Create per-week defensive stats
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
          avg_points_allowed: 0,
        };
      }

      defensiveStats[key].fantasy_points_allowed += stat.fantasy_points_ppr || 0;
      defensiveStats[key].yards_allowed += (stat.passing_yards || 0) + (stat.rushing_yards || 0) + (stat.receiving_yards || 0);
      defensiveStats[key].tds_allowed += (stat.passing_tds || 0) + (stat.rushing_tds || 0) + (stat.receiving_tds || 0);
      defensiveStats[key].games_played++;
    });

    // Calculate averages
    const defensiveRankings = Object.values(defensiveStats).map(stat => ({
      ...stat,
      avg_points_allowed: stat.fantasy_points_allowed / stat.games_played,
    }));

    console.log(`Created ${defensiveRankings.length} defensive stat entries`);

    // Calculate rankings BEFORE inserting (1 = easiest defense, 32 = hardest)
    const uniqueWeeks = [...new Set(defensiveRankings.map(r => r.week))];
    const rankingsWithRank: Array<DefensiveStat & { rank: number }> = [];
    
    for (const position of positions) {
      for (const currentWeek of uniqueWeeks) {
        const weekPositionStats = defensiveRankings
          .filter(s => s.position === position && s.week === currentWeek)
          .sort((a, b) => b.avg_points_allowed - a.avg_points_allowed);

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

    // Now compute strength of schedule
    const { data: schedules, error: schedError } = await supabase
      .from('team_schedules')
      .select('*')
      .eq('season', season);

    if (schedError) throw schedError;

    console.log(`Processing ${schedules.length} schedule entries`);

    const sosData = [];

    for (const schedule of schedules) {
      const sosEntry: any = {
        team: schedule.team,
        week: schedule.week,
        season: season,
        opponent: schedule.opponent,
      };

      // Get defensive rankings for opponent for this specific week
      for (const position of positions) {
        const defRank = rankingsWithRank.find(r => 
          r.team === schedule.opponent && 
          r.week === schedule.week && 
          r.position === position
        );

        const posKey = position.toLowerCase();
        sosEntry[`def_rank_${posKey}`] = defRank?.rank || null;
        sosEntry[`avg_points_allowed_${posKey}`] = defRank?.avg_points_allowed || 0;
      }

      sosData.push(sosEntry);
    }

    console.log(`Created ${sosData.length} SOS entries`);

    // Upsert strength of schedule
    const { error: sosError } = await supabase
      .from('strength_of_schedule')
      .upsert(sosData, {
        onConflict: 'team,week,season',
      });

    if (sosError) {
      console.error('SOS upsert error:', sosError);
      throw sosError;
    }

    console.log('Successfully upserted strength of schedule');

    return new Response(
      JSON.stringify({
        success: true,
        message: `Computed defensive rankings and SOS for ${rankingsWithRank.length} defensive entries`,
        defensiveRankings: rankingsWithRank.length,
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