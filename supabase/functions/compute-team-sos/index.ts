import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Validate authorization: TASK_KEY for cron jobs OR authenticated admin user
  const taskKey = req.headers.get('x-task-key');
  const authHeader = req.headers.get('Authorization');
  let isAuthorized = false;

  if (taskKey && taskKey === Deno.env.get('TASK_KEY')) {
    isAuthorized = true;
  }

  if (!isAuthorized && authHeader) {
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (user) {
      const { data: roles } = await supabaseAuth.from('user_roles').select('role').eq('user_id', user.id);
      if (roles?.some(r => r.role === 'admin')) {
        isAuthorized = true;
      }
    }
  }

  if (!isAuthorized) {
    console.error('Unauthorized: Invalid TASK_KEY and not an admin user');
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { season = 2025, currentWeek = 10 } = await req.json();
    
    console.log(`Computing team SOS for season ${season}, current week ${currentWeek}`);

    // Fetch schedules and defensive rankings (season-to-date) in parallel
    const [schedulesResult, defRankingsResult] = await Promise.all([
      supabase
        .from('team_schedules')
        .select('team, week, opponent')
        .eq('season', season)
        .gte('week', currentWeek),
      supabase
        .from('defensive_rankings')
        .select('team, position, week, rank')
        .eq('season', season)
        .lt('week', currentWeek)
        .limit(10000)
    ]);

    const { data: schedules, error: schedError } = schedulesResult;
    const { data: defRanks, error: defError } = defRankingsResult;

    if (schedError) {
      console.error('Schedule fetch error:', schedError);
      throw new Error(`Failed to fetch schedules: ${schedError.message}`);
    }
    if (defError) {
      console.error('Defensive rankings fetch error:', defError);
      throw new Error(`Failed to fetch defensive rankings: ${defError.message}`);
    }

    if (!schedules || schedules.length === 0) {
      throw new Error('No schedule data found');
    }
    if (!defRanks || defRanks.length === 0) {
      throw new Error('No defensive rankings found');
    }

    console.log(`Fetched ${schedules.length} schedule rows, ${defRanks.length} defensive ranking rows`);

    // Build average defensive rank map by team and position (season-to-date)
    const defAgg = new Map<string, { sum: number; count: number }>();
    for (const row of defRanks as any[]) {
      if (row.rank == null || row.position == null || row.team == null) continue;
      const key = `${row.team}:${row.position}`;
      const agg = defAgg.get(key) || { sum: 0, count: 0 };
      agg.sum += row.rank;
      agg.count += 1;
      defAgg.set(key, agg);
    }
    const defRankMap = new Map<string, number>();
    for (const [key, agg] of defAgg) {
      if (agg.count > 0) defRankMap.set(key, agg.sum / agg.count);
    }

    // Calculate SOS for each team and position
    const positions = ['QB', 'RB', 'WR', 'TE'];
    
    // Define the 32 NFL teams (standard abbreviations)
    const validNflTeams = [
      'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
      'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
      'LA', 'LAC', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
      'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS'
    ];
    
    // Only include valid NFL teams
    const allTeamsInSchedule = [...new Set(schedules.map(s => s.team))];
    const teams = allTeamsInSchedule.filter(t => validNflTeams.includes(t));
    
    console.log(`Found ${allTeamsInSchedule.length} teams in schedule, filtered to ${teams.length} valid NFL teams`);
    
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
          ros_sos: rosRanks.length > 0 ? rosAvg : null,
          playoff_sos: playoffRanks.length > 0 ? playoffAvg : null,
          ros_weeks: rosWeeks.map(w => w.week),
          playoff_weeks: playoffWeeks.map(w => w.week),
        });
      }
    }

    // Rank teams for each position: 1 = hardest (lowest avg rank), 32 = easiest (highest avg rank)
    for (const position of positions) {
      const posData = teamSosData.filter(d => d.position === position);
      
      // ROS ranking: lower ros_sos = harder = rank 1
      const rosSorted = [...posData].sort((a, b) => {
        if (a.ros_sos === null) return 1; // nulls go to end
        if (b.ros_sos === null) return -1;
        return a.ros_sos - b.ros_sos;
      });
      rosSorted.forEach((team, idx) => {
        team.ros_sos_rank = team.ros_sos !== null ? idx + 1 : null;
      });
      
      // Playoff ranking: lower playoff_sos = harder = rank 1
      const playoffSorted = [...posData].sort((a, b) => {
        if (a.playoff_sos === null) return 1;
        if (b.playoff_sos === null) return -1;
        return a.playoff_sos - b.playoff_sos;
      });
      playoffSorted.forEach((team, idx) => {
        team.playoff_sos_rank = team.playoff_sos !== null ? idx + 1 : null;
      });
    }

    // Persist to strength_of_schedule
    console.log(`Upserting ${teamSosData.length} strength_of_schedule rows for season ${season}`);

    const { error: delErr } = await supabase
      .from('strength_of_schedule')
      .delete()
      .eq('season', season);
    if (delErr) {
      console.error('Failed deleting existing strength_of_schedule rows:', delErr);
      throw new Error(`Failed to clear strength_of_schedule: ${delErr.message}`);
    }

    const insertPayload = teamSosData.map(d => ({
      team: d.team,
      season: d.season,
      position: d.position,
      ros_sos: d.ros_sos,
      playoff_sos: d.playoff_sos,
      ros_sos_rank: d.ros_sos_rank,
      playoff_sos_rank: d.playoff_sos_rank,
      ros_weeks: d.ros_weeks,
      playoff_weeks: d.playoff_weeks,
    }));

    const { error: insErr } = await supabase
      .from('strength_of_schedule')
      .insert(insertPayload);
    if (insErr) {
      console.error('Insert strength_of_schedule error:', insErr);
      throw new Error(`Failed to insert strength_of_schedule: ${insErr.message}`);
    }

    console.log('Successfully wrote strength_of_schedule');

    return new Response(
      JSON.stringify({
        success: true,
        season,
        currentWeek,
        written: insertPayload.length
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
