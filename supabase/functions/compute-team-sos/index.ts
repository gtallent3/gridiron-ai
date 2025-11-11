import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Configuration
const PLAYOFF_WEEKS = [14, 15, 16, 17];
const POSITIONS = ['QB', 'RB', 'WR', 'TE'];

// SOS Rank Direction: Lower number = EASIER schedule for offense (weaker defense)
// We invert defensive ranks so that rank 1 (best defense) becomes rank 32 (hardest matchup for offense)
// and rank 32 (worst defense) becomes rank 1 (easiest matchup for offense)
const invertDefensiveRank = (defRank: number) => 33 - defRank;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get parameters from request body or use defaults
    let season = 2025;
    let currentWeek = 1;

    try {
      const body = await req.json();
      season = body.season ?? 2025;
      currentWeek = body.currentWeek;
    } catch {
      // If no body, we'll determine current week from data
    }

    // Determine current week if not provided
    if (!currentWeek) {
      console.log('Determining current week from player data...');
      
      const { data: weekData } = await supabase
        .from('nfl_fantasy_points')
        .select('week')
        .eq('season', season)
        .not('fantasy_points_ppr', 'is', null)
        .order('week', { ascending: false })
        .limit(1);

      if (weekData && weekData.length > 0) {
        currentWeek = weekData[0].week + 1;
      } else {
        currentWeek = 1;
      }
    }

    console.log(`Computing team SOS for season ${season}, current week ${currentWeek}`);

    // Fetch team schedules (remaining weeks only)
    const { data: schedules, error: schedError } = await supabase
      .from('team_schedules')
      .select('team, week, opponent')
      .eq('season', season)
      .gte('week', currentWeek);

    if (schedError) {
      console.error('Schedule fetch error:', schedError);
      throw new Error(`Failed to fetch schedules: ${schedError.message}`);
    }

    if (!schedules || schedules.length === 0) {
      throw new Error('No schedule data found');
    }

    console.log(`Fetched ${schedules.length} schedule records`);

    // Fetch defensive rankings - we need the most recent week's rankings for each team/position
    const { data: defRankings, error: defError } = await supabase
      .from('defensive_rankings')
      .select('team, position, rank, week')
      .eq('season', season)
      .order('week', { ascending: false });

    if (defError) {
      console.error('Defensive rankings fetch error:', defError);
      throw new Error(`Failed to fetch defensive rankings: ${defError.message}`);
    }

    if (!defRankings || defRankings.length === 0) {
      throw new Error('No defensive rankings data found');
    }

    console.log(`Fetched ${defRankings.length} defensive ranking records`);

    // Build defense rank map - use most recent week's ranking for each team/position
    const defRankMap = new Map<string, number>();
    const processedKeys = new Set<string>();

    defRankings.forEach((row: any) => {
      const key = `${row.team}:${row.position}`;
      if (!processedKeys.has(key) && row.rank != null) {
        defRankMap.set(key, row.rank);
        processedKeys.add(key);
      }
    });

    console.log(`Built defense rank map with ${defRankMap.size} entries`);

    // Get all unique teams
    const teams = [...new Set(schedules.map(s => s.team))];
    
    const sosResults: any[] = [];

    // Calculate SOS for each team and position
    for (const team of teams) {
      const teamSchedule = schedules.filter(s => s.team === team);

      for (const position of POSITIONS) {
        // ROS weeks: all remaining weeks (current_week to 17) with valid opponent
        const rosWeeks = teamSchedule
          .filter(s => s.week >= currentWeek && s.week <= 17 && s.opponent && s.opponent !== 'BYE')
          .map(s => s.week);

        // Playoff weeks: intersection of PLAYOFF_WEEKS and remaining schedule
        const playoffWeeks = teamSchedule
          .filter(s => 
            PLAYOFF_WEEKS.includes(s.week) && 
            s.week >= currentWeek && 
            s.opponent && 
            s.opponent !== 'BYE'
          )
          .map(s => s.week);

        // Calculate ROS SOS
        let rosSos: number | null = null;
        if (rosWeeks.length > 0) {
          const rosRanks: number[] = [];
          
          for (const week of rosWeeks) {
            const matchup = teamSchedule.find(s => s.week === week);
            if (matchup?.opponent) {
              const defRank = defRankMap.get(`${matchup.opponent}:${position}`);
              if (defRank != null) {
                // Invert so lower number = easier matchup for offense
                rosRanks.push(invertDefensiveRank(defRank));
              }
            }
          }

          if (rosRanks.length > 0) {
            rosSos = rosRanks.reduce((sum, rank) => sum + rank, 0) / rosRanks.length;
          }
        }

        // Calculate Playoff SOS
        let playoffSos: number | null = null;
        if (playoffWeeks.length > 0) {
          const playoffRanks: number[] = [];
          
          for (const week of playoffWeeks) {
            const matchup = teamSchedule.find(s => s.week === week);
            if (matchup?.opponent) {
              const defRank = defRankMap.get(`${matchup.opponent}:${position}`);
              if (defRank != null) {
                // Invert so lower number = easier matchup for offense
                playoffRanks.push(invertDefensiveRank(defRank));
              }
            }
          }

          if (playoffRanks.length > 0) {
            playoffSos = playoffRanks.reduce((sum, rank) => sum + rank, 0) / playoffRanks.length;
          }
        }

        sosResults.push({
          season,
          team,
          position,
          ros_sos: rosSos,
          playoff_sos: playoffSos,
          ros_weeks: rosWeeks,
          playoff_weeks: playoffWeeks,
        });
      }
    }

    console.log(`Computed SOS for ${sosResults.length} team-position combinations`);

    // Delete existing data for this season
    const { error: deleteError } = await supabase
      .from('strength_of_schedule')
      .delete()
      .eq('season', season);

    if (deleteError) {
      console.error('Error deleting old SOS data:', deleteError);
      throw new Error(`Failed to delete old SOS data: ${deleteError.message}`);
    }

    // Insert new SOS data
    const { error: insertError } = await supabase
      .from('strength_of_schedule')
      .insert(sosResults);

    if (insertError) {
      console.error('Error inserting SOS data:', insertError);
      throw new Error(`Failed to insert SOS data: ${insertError.message}`);
    }

    console.log(`Successfully stored ${sosResults.length} SOS records for season ${season}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        records: sosResults.length,
        season,
        currentWeek
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error computing team SOS:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
