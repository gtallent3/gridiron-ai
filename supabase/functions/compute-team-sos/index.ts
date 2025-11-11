import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { season = 2025, currentWeek = 10 } = await req.json();
    
    console.log(`Computing team SOS for season ${season}, current week ${currentWeek}`);

    // Fetch both queries in parallel to reduce latency
    const [schedulesResult, sosDataResult] = await Promise.all([
      supabase
        .from('team_schedules')
        .select('team, week, opponent')
        .eq('season', season)
        .gte('week', currentWeek),
      supabase
        .from('strength_of_schedule')
        .select('team, def_rank_qb, def_rank_rb, def_rank_wr, def_rank_te')
        .eq('season', season)
    ]);

    const { data: schedules, error: schedError } = schedulesResult;
    const { data: sosData, error: sosError } = sosDataResult;

    if (schedError) {
      console.error('Schedule fetch error:', schedError);
      throw new Error(`Failed to fetch schedules: ${schedError.message}`);
    }
    if (sosError) {
      console.error('SOS data fetch error:', sosError);
      throw new Error(`Failed to fetch SOS data: ${sosError.message}`);
    }

    if (!schedules || schedules.length === 0) {
      throw new Error('No schedule data found');
    }

    if (!sosData || sosData.length === 0) {
      throw new Error('No SOS data found');
    }

    console.log(`Fetched ${schedules.length} schedule records, ${sosData.length} SOS records`);

    // Create defense rank map by team and position
    const defRankMap = new Map<string, number>();
    sosData.forEach((row: any) => {
      if (row.def_rank_qb) defRankMap.set(`${row.team}:QB`, row.def_rank_qb);
      if (row.def_rank_rb) defRankMap.set(`${row.team}:RB`, row.def_rank_rb);
      if (row.def_rank_wr) defRankMap.set(`${row.team}:WR`, row.def_rank_wr);
      if (row.def_rank_te) defRankMap.set(`${row.team}:TE`, row.def_rank_te);
    });

    // Calculate SOS for each team and position
    const positions = ['QB', 'RB', 'WR', 'TE'];
    const teams = [...new Set(schedules.map(s => s.team))];
    
    const teamSosData: any[] = [];

    for (const team of teams) {
      const teamSchedule = schedules.filter(s => s.team === team);
      const rosWeeks = teamSchedule.filter(s => s.week >= currentWeek);
      const playoffWeeks = teamSchedule.filter(s => s.week >= 15 && s.week <= 17);

      for (const position of positions) {
        // Calculate ROS average
        const rosRanks = rosWeeks
          .map(s => defRankMap.get(`${s.opponent}:${position}`))
          .filter(r => r !== undefined) as number[];
        
        const rosAvg = rosRanks.length > 0 
          ? rosRanks.reduce((a, b) => a + b, 0) / rosRanks.length 
          : 0;

        // Calculate playoff average
        const playoffRanks = playoffWeeks
          .map(s => defRankMap.get(`${s.opponent}:${position}`))
          .filter(r => r !== undefined) as number[];
        
        const playoffAvg = playoffRanks.length > 0 
          ? playoffRanks.reduce((a, b) => a + b, 0) / playoffRanks.length 
          : 0;

        teamSosData.push({
          team,
          season,
          position,
          ros_avg_def_rank: rosAvg,
          playoff_avg_def_rank: playoffAvg,
        });
      }
    }

    // Rank teams for each position (1 = hardest, 32 = easiest)
    for (const position of positions) {
      const positionData = teamSosData.filter(d => d.position === position);
      
      // ROS ranking (lower avg rank = harder schedule = rank 1)
      positionData.sort((a, b) => a.ros_avg_def_rank - b.ros_avg_def_rank);
      positionData.forEach((d, idx) => {
        d.ros_sos_rank = d.ros_avg_def_rank > 0 ? idx + 1 : null;
      });

      // Playoff ranking
      positionData.sort((a, b) => a.playoff_avg_def_rank - b.playoff_avg_def_rank);
      positionData.forEach((d, idx) => {
        d.playoff_sos_rank = d.playoff_avg_def_rank > 0 ? idx + 1 : null;
      });
    }

    // Note: team_sos table was removed - SOS data computed but not stored
    console.log(`Computed SOS for ${teamSosData.length} team-position combinations`);

    console.log(`Successfully computed SOS for ${teamSosData.length} team-position combinations`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        records: teamSosData.length 
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
