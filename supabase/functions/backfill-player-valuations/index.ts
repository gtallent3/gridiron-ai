import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};

// Backfill historical player valuations for a specific week
serve(async (req) => {
  console.log(`Request method: ${req.method}`);
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 200,
      headers: corsHeaders 
    });
  }

  try {
    const { week } = await req.json();
    
    if (!week || week < 1 || week > 18) {
      return new Response(
        JSON.stringify({ error: 'Valid week parameter (1-18) is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`Starting backfill for week ${week}...`);

    const now = new Date();
    const currentSeason = 2025;
    
    // Calculate current week to know what data is available
    const seasonStart = new Date(2025, 8, 5);
    const weeksSinceStart = Math.floor((now.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
    const currentWeek = Math.min(Math.max(weeksSinceStart + 1, 1), 18);

    // Can't backfill future weeks
    if (week > currentWeek) {
      return new Response(
        JSON.stringify({ error: `Cannot backfill week ${week} - current week is ${currentWeek}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch all required data in parallel
    const [sleeperPlayers, trending, nflState] = await Promise.all([
      fetch('https://api.sleeper.app/v1/players/nfl').then(r => r.json()),
      fetch('https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=168&limit=200').then(r => r.json()),
      fetch(`https://api.sleeper.app/v1/state/nfl`).then(r => r.json())
    ]);
    
    const trendingIds = new Set(trending.map((t: any) => t.player_id));
    const trendingCountMap = new Map(trending.map((t: any) => [t.player_id, t.count || 1]));

    // 2025-26 NFL Bye Week Schedule
    const byeWeekSchedule = new Map<string, number>([
      ['ATL', 5], ['CHI', 5], ['GB', 5], ['PIT', 5],
      ['HOU', 6], ['MIN', 6],
      ['BAL', 7], ['BUF', 7],
      ['ARI', 8], ['DET', 8], ['JAX', 8], ['LV', 8], ['LAR', 8], ['SEA', 8],
      ['CLE', 9], ['NYJ', 9], ['PHI', 9], ['TB', 9],
      ['CIN', 10], ['DAL', 10], ['KC', 10], ['TEN', 10],
      ['IND', 11], ['NO', 11],
      ['DEN', 12], ['LAC', 12], ['MIA', 12], ['WAS', 12],
      ['CAR', 14], ['NE', 14], ['NYG', 14], ['SF', 14],
    ]);

    // Fetch player stats up to current week
    const statsPromises = [];
    for (let w = 1; w <= currentWeek; w++) {
      statsPromises.push(
        fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${currentSeason}/${w}`).then(r => r.json())
      );
    }
    const weeklyStats = await Promise.all(statsPromises);
    
    // Aggregate player stats
    const playerStats = new Map();
    weeklyStats.forEach((weekStats) => {
      Object.entries(weekStats).forEach(([playerId, stats]: [string, any]) => {
        if (!playerStats.has(playerId)) {
          playerStats.set(playerId, { totalPoints: 0, gamesPlayed: 0, weeklyPoints: [] });
        }
        const playerStat = playerStats.get(playerId);
        const points = stats.pts_std || 0;
        playerStat.totalPoints += points;
        playerStat.gamesPlayed += points > 0 ? 1 : 0;
        playerStat.weeklyPoints.push(points);
        playerStat.lastStats = stats;
      });
    });

    // Position-specific defensive rankings
    const defensiveRankings = {
      vsQB: new Map([
        ['BAL', 1], ['SF', 2], ['NYJ', 3], ['BUF', 4], ['CLE', 5],
        ['DEN', 6], ['PIT', 7], ['DAL', 8], ['MIA', 9], ['PHI', 10],
        ['KC', 11], ['LAC', 12], ['SEA', 13], ['NO', 14], ['MIN', 15],
        ['GB', 16], ['DET', 17], ['NE', 18], ['IND', 19], ['ATL', 20],
        ['TB', 21], ['TEN', 22], ['CIN', 23], ['LAR', 24], ['HOU', 25],
        ['LV', 26], ['JAX', 27], ['NYG', 28], ['CAR', 29], ['WAS', 30],
        ['ARI', 31], ['CHI', 32]
      ]),
      vsRB: new Map([
        ['SF', 1], ['BAL', 2], ['BUF', 3], ['DEN', 4], ['PIT', 5],
        ['CLE', 6], ['DAL', 7], ['NYJ', 8], ['PHI', 9], ['KC', 10],
        ['MIA', 11], ['SEA', 12], ['MIN', 13], ['LAC', 14], ['GB', 15],
        ['NO', 16], ['NE', 17], ['DET', 18], ['IND', 19], ['TB', 20],
        ['ATL', 21], ['CIN', 22], ['TEN', 23], ['LAR', 24], ['LV', 25],
        ['HOU', 26], ['JAX', 27], ['CAR', 28], ['NYG', 29], ['ARI', 30],
        ['WAS', 31], ['CHI', 32]
      ]),
      vsWR: new Map([
        ['NYJ', 1], ['BUF', 2], ['SF', 3], ['CLE', 4], ['BAL', 5],
        ['MIA', 6], ['DEN', 7], ['PIT', 8], ['DAL', 9], ['LAC', 10],
        ['KC', 11], ['PHI', 12], ['SEA', 13], ['MIN', 14], ['NO', 15],
        ['GB', 16], ['NE', 17], ['IND', 18], ['DET', 19], ['ATL', 20],
        ['TB', 21], ['CIN', 22], ['TEN', 23], ['LAR', 24], ['HOU', 25],
        ['LV', 26], ['JAX', 27], ['CAR', 28], ['NYG', 29], ['WAS', 30],
        ['ARI', 31], ['CHI', 32]
      ]),
      vsTE: new Map([
        ['DEN', 1], ['MIA', 2], ['NYJ', 3], ['BUF', 4], ['SF', 5],
        ['BAL', 6], ['PIT', 7], ['KC', 8], ['CLE', 9], ['DAL', 10],
        ['LAC', 11], ['PHI', 12], ['MIN', 13], ['SEA', 14], ['NO', 15],
        ['GB', 16], ['IND', 17], ['NE', 18], ['DET', 19], ['ATL', 20],
        ['TB', 21], ['TEN', 22], ['CIN', 23], ['LAR', 24], ['LV', 25],
        ['HOU', 26], ['JAX', 27], ['CAR', 28], ['NYG', 29], ['ARI', 30],
        ['WAS', 31], ['CHI', 32]
      ])
    };

    // Team offensive context
    const teamContext = new Map([
      ['KC', { pace: 1.15, passRate: 0.62, rzEff: 1.2 }],
      ['BUF', { pace: 1.12, passRate: 0.60, rzEff: 1.15 }],
      ['MIA', { pace: 1.20, passRate: 0.65, rzEff: 1.1 }],
      ['SF', { pace: 1.10, passRate: 0.55, rzEff: 1.25 }],
      ['DAL', { pace: 1.08, passRate: 0.58, rzEff: 1.18 }],
      ['PHI', { pace: 1.06, passRate: 0.56, rzEff: 1.22 }],
      ['CIN', { pace: 1.14, passRate: 0.63, rzEff: 1.12 }],
      ['DET', { pace: 1.11, passRate: 0.59, rzEff: 1.16 }],
      ['LAC', { pace: 1.09, passRate: 0.61, rzEff: 1.14 }],
      ['TB', { pace: 1.07, passRate: 0.62, rzEff: 1.10 }],
    ]);

    const defaultContext = { pace: 1.0, passRate: 0.57, rzEff: 1.0 };

    // NFL Schedule 2025-26 Season
    const nflSchedule = new Map([
      ['ARI', ['NO', 'CAR', 'SF', 'SEA', 'TEN', 'IND', 'GB', null, 'DAL', 'SEA', 'SF', 'JAX', 'TB', 'LAR', 'HOU', 'ATL', 'CIN', 'LAR']],
      ['ATL', ['TB', 'MIN', 'CAR', 'WAS', null, 'BUF', 'SF', 'MIA', 'NE', 'IND', 'CAR', 'NO', 'NYJ', 'SEA', 'TB', 'ARI', 'LAR', 'NO']],
      ['BAL', ['BUF', 'CLE', 'DET', 'KC', 'HOU', 'LAR', null, 'CHI', 'MIA', 'MIN', 'CLE', 'NYJ', 'CIN', 'PIT', 'CIN', 'NE', 'GB', 'PIT']],
      ['BUF', ['BAL', 'NYJ', 'MIA', 'NO', 'NE', 'ATL', null, 'CAR', 'KC', 'MIA', 'TB', 'HOU', 'PIT', 'CIN', 'NE', 'CLE', 'PHI', 'NYJ']],
      ['CAR', ['JAX', 'ARI', 'ATL', 'NE', 'MIA', 'DAL', 'NYJ', 'BUF', 'GB', 'NO', 'ATL', 'SF', 'LAR', null, 'NO', 'TB', 'SEA', 'TB']],
      ['CHI', ['MIN', 'DET', 'DAL', 'LV', null, 'WAS', 'NO', 'BAL', 'CIN', 'NYG', 'MIN', 'PIT', 'PHI', 'GB', 'CLE', 'GB', 'SF', 'DET']],
      ['CIN', ['CLE', 'JAX', 'MIN', 'DEN', 'DET', 'GB', 'PIT', 'NYJ', 'CHI', null, 'PIT', 'NE', 'BAL', 'BUF', 'BAL', 'MIA', 'ARI', 'CLE']],
      ['CLE', ['CIN', 'BAL', 'GB', 'DET', 'MIN', 'PIT', 'MIA', 'NE', null, 'NYJ', 'BAL', 'LV', 'SF', 'TEN', 'CHI', 'BUF', 'PIT', 'CIN']],
      ['DAL', ['PHI', 'NYG', 'CHI', 'GB', 'NYJ', 'CAR', 'WAS', 'DEN', 'ARI', null, 'LV', 'PHI', 'KC', 'DET', 'MIN', 'LAC', 'WAS', 'NYG']],
      ['DEN', ['TEN', 'IND', 'LAC', 'CIN', 'PHI', 'NYJ', 'NYG', 'DAL', 'HOU', 'LV', 'KC', null, 'WAS', 'LV', 'GB', 'JAX', 'KC', 'LAC']],
      ['DET', ['GB', 'CHI', 'BAL', 'CLE', 'CIN', 'KC', 'TB', null, 'MIN', 'WAS', 'PHI', 'NYG', 'GB', 'DAL', 'LAR', 'PIT', 'MIN', 'CHI']],
      ['GB', ['DET', 'WAS', 'CLE', 'DAL', null, 'CIN', 'ARI', 'PIT', 'CAR', 'PHI', 'NYG', 'MIN', 'DET', 'CHI', 'DEN', 'CHI', 'BAL', 'MIN']],
      ['HOU', ['LAR', 'TB', 'JAX', 'TEN', 'BAL', null, 'SEA', 'SF', 'DEN', 'JAX', 'TEN', 'BUF', 'IND', 'KC', 'ARI', 'LV', 'LAC', 'IND']],
      ['IND', ['MIA', 'DEN', 'TEN', 'LAR', 'LV', 'ARI', 'LAC', 'TEN', 'PIT', 'ATL', null, 'KC', 'HOU', 'JAX', 'SEA', 'SF', 'JAX', 'HOU']],
      ['JAX', ['CAR', 'CIN', 'HOU', 'SF', 'KC', 'SEA', 'LAR', null, 'LV', 'HOU', 'LAC', 'ARI', 'TEN', 'IND', 'NYJ', 'DEN', 'IND', 'TEN']],
      ['KC', ['LAC', 'PHI', 'NYG', 'BAL', 'JAX', 'DET', 'LV', 'WAS', 'BUF', null, 'DEN', 'IND', 'DAL', 'HOU', 'LAC', 'TEN', 'DEN', 'LV']],
      ['LV', ['NE', 'LAC', 'WAS', 'CHI', 'IND', 'TEN', 'KC', null, 'JAX', 'DEN', 'DAL', 'CLE', 'LAC', 'DEN', 'PHI', 'HOU', 'NYG', 'KC']],
      ['LAR', ['HOU', 'TEN', 'PHI', 'IND', 'SF', 'BAL', 'JAX', null, 'NO', 'SF', 'SEA', 'TB', 'CAR', 'ARI', 'DET', 'SEA', 'ATL', 'ARI']],
      ['LAC', ['KC', 'LV', 'DEN', 'NYG', 'WAS', 'MIA', 'IND', 'MIN', 'TEN', 'PIT', 'JAX', null, 'LV', 'PHI', 'KC', 'DAL', 'HOU', 'DEN']],
      ['MIA', ['IND', 'NE', 'BUF', 'NYJ', 'CAR', 'LAC', 'CLE', 'ATL', 'BAL', 'BUF', 'WAS', null, 'NO', 'NYJ', 'PIT', 'CIN', 'TB', 'NE']],
      ['MIN', ['CHI', 'ATL', 'CIN', 'PIT', 'CLE', null, 'PHI', 'LAC', 'DET', 'BAL', 'CHI', 'GB', 'SEA', 'WAS', 'DAL', 'NYG', 'DET', 'GB']],
      ['NE', ['LV', 'MIA', 'PIT', 'CAR', 'BUF', 'NO', 'TEN', 'CLE', 'ATL', 'TB', 'NYJ', 'CIN', 'NYG', null, 'BUF', 'BAL', 'NYJ', 'MIA']],
      ['NO', ['ARI', 'SF', 'SEA', 'BUF', 'NYG', 'NE', 'CHI', 'TB', 'LAR', 'CAR', null, 'ATL', 'MIA', 'TB', 'CAR', 'NYJ', 'TEN', 'ATL']],
      ['NYG', ['WAS', 'DAL', 'KC', 'LAC', 'NO', 'PHI', 'DEN', 'PHI', 'SF', 'CHI', 'GB', 'DET', 'NE', null, 'WAS', 'MIN', 'LV', 'DAL']],
      ['NYJ', ['PIT', 'BUF', 'TB', 'MIA', 'DAL', 'DEN', 'CAR', 'CIN', null, 'CLE', 'NE', 'BAL', 'ATL', 'MIA', 'JAX', 'NO', 'NE', 'BUF']],
      ['PHI', ['DAL', 'KC', 'LAR', 'TB', 'DEN', 'NYG', 'MIN', 'NYG', null, 'GB', 'DET', 'DAL', 'CHI', 'LAC', 'LV', 'WAS', 'BUF', 'WAS']],
      ['PIT', ['NYJ', 'SEA', 'NE', 'MIN', null, 'CLE', 'CIN', 'GB', 'IND', 'LAC', 'CIN', 'CHI', 'BUF', 'BAL', 'MIA', 'DET', 'CLE', 'BAL']],
      ['SF', ['SEA', 'NO', 'ARI', 'JAX', 'LAR', 'TB', 'ATL', 'HOU', 'NYG', 'LAR', 'ARI', 'CAR', 'CLE', null, 'TEN', 'IND', 'CHI', 'SEA']],
      ['SEA', ['SF', 'PIT', 'NO', 'ARI', 'TB', 'JAX', 'HOU', null, 'WAS', 'ARI', 'LAR', 'TEN', 'MIN', 'ATL', 'IND', 'LAR', 'CAR', 'SF']],
      ['TB', ['ATL', 'HOU', 'NYJ', 'PHI', 'SEA', 'SF', 'DET', 'NO', null, 'NE', 'BUF', 'LAR', 'ARI', 'NO', 'ATL', 'CAR', 'MIA', 'CAR']],
      ['TEN', ['DEN', 'LAR', 'IND', 'HOU', 'ARI', 'LV', 'NE', 'IND', 'LAC', null, 'HOU', 'SEA', 'JAX', 'CLE', 'SF', 'KC', 'NO', 'JAX']],
      ['WAS', ['NYG', 'GB', 'LV', 'ATL', 'LAC', 'CHI', 'DAL', 'KC', 'SEA', 'DET', 'MIA', null, 'DEN', 'MIN', 'NYG', 'PHI', 'DAL', 'PHI']],
    ]);

    const getDefensiveMultiplier = (opponent: string | null, position: string): number => {
      if (!opponent) return 1.0;
      
      let defMap: Map<string, number>;
      if (position === 'QB') defMap = defensiveRankings.vsQB;
      else if (position === 'RB') defMap = defensiveRankings.vsRB;
      else if (position === 'TE') defMap = defensiveRankings.vsTE;
      else defMap = defensiveRankings.vsWR;
      
      const rank = defMap.get(opponent) || 16;
      return 1.0 - ((rank - 16.5) * 0.01);
    };

    // Build filtered entries for active and relevant players
    const playerEntries = Object.entries(sleeperPlayers).filter(([id, player]: [string, any]) => {
      const p = player as any;
      const pos = p.fantasy_positions?.[0];
      const isFantasyRelevant = pos && ['QB','RB','WR','TE','K','DEF'].includes(pos);
      const status = (p.status || '').toString().toLowerCase();
      const isRetired = status === 'retired';
      const isInactive = status === 'inactive';
      const isActiveFlag = p.active === true;
      const hasRecentStats = playerStats.has(id);
      const isTrending = trendingIds.has(id);
      const hasTeam = !!p.team;

      return (
        isFantasyRelevant &&
        !isRetired &&
        !(p.active === false && isInactive) &&
        (isActiveFlag || hasRecentStats || isTrending) &&
        (hasTeam || hasRecentStats)
      );
    });

    const valuations: any[] = [];
    
    console.log(`Processing valuations for week ${week}...`);
    
    for (const [playerId, player] of playerEntries) {
      const p = player as any;
      const position = p.fantasy_positions[0];
      const stats = playerStats.get(playerId);
      
      // Calculate stats up to target week
      const weeklyPointsUpToTarget = stats?.weeklyPoints.slice(0, week) || [];
      const gamesPlayedUpToTarget = weeklyPointsUpToTarget.filter((pts: number) => pts > 0).length;
      const totalPointsUpToTarget = weeklyPointsUpToTarget.reduce((sum: number, pts: number) => sum + pts, 0);
      const avgPointsPerGame = gamesPlayedUpToTarget > 0 ? totalPointsUpToTarget / gamesPlayedUpToTarget : 0;
      
      const recentForm = weeklyPointsUpToTarget.slice(-3);
      const recentAvg = recentForm.length > 0 ? recentForm.reduce((a: number, b: number) => a + b, 0) / recentForm.length : avgPointsPerGame;
      
      const variance = weeklyPointsUpToTarget.length > 0 
        ? weeklyPointsUpToTarget.reduce((acc: number, pts: number) => acc + Math.pow(pts - avgPointsPerGame, 2), 0) / weeklyPointsUpToTarget.length
        : 0;
      const standardDev = Math.sqrt(variance);
      
      // For historical weeks, use actual points scored that week as PPG
      const actualPointsThisWeek = stats?.weeklyPoints[week - 1] || 0;
      const basePpgProjection = actualPointsThisWeek;
      
      // No team multiplier needed for actual historical scores
      const adjustedBasePpg = basePpgProjection;
      
      // Week-by-week ROS projection from this week's perspective
      const teamSchedule = nflSchedule.get(p.team) || [];
      let rosProjection = 0;
      let championshipWeeksProjection = 0;
      let remainingByeWeeks = 0;
      let next3WeeksTotal = 0;
      const weeklyProjections: any[] = [];
      
      for (let w = week; w <= 18; w++) {
        const weekIndex = w - 1;
        const opponent = teamSchedule[weekIndex];
        
        if (opponent === null || opponent === undefined) {
          remainingByeWeeks++;
          weeklyProjections.push({ week: w, opponent: null, projection: 0, isBye: true });
          continue;
        }
        
        let weekProjection = 0;
        
        // Use actual scores for weeks that have been played
        if (w <= currentWeek) {
          weekProjection = stats?.weeklyPoints[w - 1] || 0;
        } else {
          // Use projection for future weeks
          const context = teamContext.get(p.team) || defaultContext;
          let teamMultiplier = 1.0;
          
          if (position === 'QB') {
            teamMultiplier = context.pace * (1 + (context.passRate - 0.57) * 0.5);
          } else if (position === 'RB') {
            teamMultiplier = context.pace * (1 + (0.57 - context.passRate) * 0.3) * context.rzEff;
          } else if (position === 'WR' || position === 'TE') {
            teamMultiplier = context.pace * (1 + (context.passRate - 0.57) * 0.4) * (context.rzEff * 0.8);
          }
          
          const baselines = { QB: 18, RB: 12, WR: 11, TE: 8, K: 7, DEF: 8 };
          const projectedBasePpg = gamesPlayedUpToTarget >= 3 
            ? avgPointsPerGame * 0.6 + recentAvg * 0.4
            : gamesPlayedUpToTarget > 0 
              ? avgPointsPerGame * 0.8
              : (baselines[position as keyof typeof baselines] || 10);
          
          const defenseMultiplier = getDefensiveMultiplier(opponent, position);
          const homeAwayMultiplier = w % 2 === 0 ? 1.02 : 0.98;
          weekProjection = projectedBasePpg * teamMultiplier * defenseMultiplier * homeAwayMultiplier;
        }
        
        // Championship weeks bonus for projections only
        if (w >= 15 && w <= 17) {
          if (w > currentWeek) {
            weekProjection *= 1.1;
          }
          championshipWeeksProjection += weekProjection;
        }
        
        rosProjection += weekProjection;
        
        if (w < week + 3) {
          next3WeeksTotal += weekProjection;
        }
        
        weeklyProjections.push({ 
          week: w, 
          opponent, 
          projection: Math.round(weekProjection * 10) / 10,
          isBye: false 
        });
      }
      
      // Sentiment scoring
      let sentimentScore = 0;
      if (trendingIds.has(playerId)) {
        const trendCount = Number(trendingCountMap.get(playerId) || 1);
        sentimentScore = Math.min(0.25, 0.05 + (trendCount / 100) * 0.2);
      } else if (gamesPlayedUpToTarget > 0 && recentAvg > avgPointsPerGame * 1.2) {
        sentimentScore = 0.08;
      } else {
        sentimentScore = -0.03;
      }
      
      // Usage trend
      let usageTrend = 0;
      if (stats?.lastStats && week === currentWeek) {
        const lastStats = stats.lastStats;
        if (position === 'RB') {
          const carries = lastStats.rush_att || 0;
          usageTrend = carries > 15 ? 0.15 : carries > 10 ? 0.08 : 0;
        } else if (position === 'WR' || position === 'TE') {
          const targets = lastStats.rec_tgt || 0;
          usageTrend = targets > 8 ? 0.15 : targets > 5 ? 0.08 : 0;
        } else if (position === 'QB') {
          const attempts = lastStats.pass_att || 0;
          usageTrend = attempts > 35 ? 0.12 : attempts > 28 ? 0.06 : 0;
        }
      }
      
      // Role stability
      let roleStability = 0.5;
      if (gamesPlayedUpToTarget >= 6) {
        const consistency = standardDev > 0 ? 1 - Math.min(standardDev / avgPointsPerGame, 1) : 0.5;
        const volumeStability = p.years_exp > 3 ? 0.9 : p.years_exp > 1 ? 0.7 : 0.5;
        roleStability = (consistency * 0.6 + volumeStability * 0.4);
      } else if (gamesPlayedUpToTarget > 0) {
        roleStability = 0.6;
      }
      
      const teamByeWeek = byeWeekSchedule.get(p.team);
      const isByeWeek = teamByeWeek === week;
      
      // Injury risk
      let injuryRisk = 0.05;
      let injuryDuration = 0;
      let injuryMultiplier = 1.0;
      let currentInjuryStatus = p.injury_status || null;
      
      if (currentInjuryStatus === 'Out') {
        injuryRisk = 0.9;
        injuryDuration = 1;
        injuryMultiplier = 0.9;
      } else if (currentInjuryStatus === 'Doubtful' || currentInjuryStatus === 'D') {
        injuryRisk = 0.7;
        injuryDuration = 1;
        injuryMultiplier = 0.9;
      } else if (currentInjuryStatus === 'Questionable' || currentInjuryStatus === 'Q') {
        injuryRisk = 0.4;
        injuryDuration = 1;
        injuryMultiplier = 0.95;
      } else if (currentInjuryStatus === 'IR' || currentInjuryStatus === 'PUP') {
        injuryRisk = 1.0;
        injuryDuration = 4;
        injuryMultiplier = 0.3;
      }
      
      // Apply injury to projections only (not historical actuals)
      rosProjection *= injuryMultiplier;
      championshipWeeksProjection *= injuryMultiplier;
      next3WeeksTotal *= injuryMultiplier;
      
      const next3WeeksProjection = next3WeeksTotal;
      const sentimentMultiplier = (1 + Math.max(-0.3, Math.min(0.3, sentimentScore)));
      const usageTrendMultiplier = (1 + usageTrend);
      
      const playerValue = rosProjection * sentimentMultiplier * usageTrendMultiplier;
      
      // Schedule difficulty
      const playoffGames = weeklyProjections.filter(w => w.week >= 15 && w.week <= 17 && !w.isBye);
      const playoffScheduleDifficulty = playoffGames.length > 0
        ? playoffGames.reduce((sum, w) => {
            const defMap = position === 'QB' ? defensiveRankings.vsQB :
                          position === 'RB' ? defensiveRankings.vsRB :
                          position === 'TE' ? defensiveRankings.vsTE :
                          defensiveRankings.vsWR;
            return sum + ((defMap.get(w.opponent!) || 16) / 32);
          }, 0) / playoffGames.length
        : 0.5;
      
      const allGames = weeklyProjections.filter(w => !w.isBye);
      const scheduleDifficulty = allGames.length > 0
        ? allGames.reduce((sum, w) => {
            const defMap = position === 'QB' ? defensiveRankings.vsQB :
                          position === 'RB' ? defensiveRankings.vsRB :
                          position === 'TE' ? defensiveRankings.vsTE :
                          defensiveRankings.vsWR;
            return sum + ((defMap.get(w.opponent!) || 16) / 32);
          }, 0) / allGames.length
        : 0.5;
      
      const availableWeeks = 18 - week - remainingByeWeeks;
      const ppgProjection = availableWeeks > 0 ? rosProjection / availableWeeks : basePpgProjection;
      
      const isVolatile = injuryRisk > 0.3 || roleStability < 0.6 || standardDev > avgPointsPerGame * 0.6;
      
      const confidence = Math.round(
        Math.max(0, Math.min(100,
          50 +
          (gamesPlayedUpToTarget * 3) +
          (roleStability * 25) +
          (sentimentScore * 40) -
          (injuryRisk * 30) -
          (standardDev > avgPointsPerGame * 0.5 ? 15 : 0)
        ))
      );

      valuations.push({
        player_id: playerId,
        player_name: (p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`).trim(),
        position,
        team: p.team || 'FA',
        season: currentSeason,
        week: week,
        player_value: Math.round(playerValue * 10) / 10,
        ros_projection: Math.round(rosProjection * 10) / 10,
        ppg_projection: Math.round(ppgProjection * 10) / 10,
        next_3_weeks_projection: Math.round(next3WeeksProjection * 10) / 10,
        championship_weeks_projection: Math.round(championshipWeeksProjection * 10) / 10,
        remaining_bye_weeks: remainingByeWeeks,
        remaining_schedule: weeklyProjections,
        schedule_difficulty: Math.round(scheduleDifficulty * 100) / 100,
        playoff_schedule_difficulty: Math.round(playoffScheduleDifficulty * 100) / 100,
        sentiment_score: Math.round(sentimentScore * 100) / 100,
        usage_trend: Math.round(usageTrend * 100) / 100,
        role_stability: Math.round(roleStability * 100) / 100,
        injury_risk: Math.round(injuryRisk * 100) / 100,
        volatility_flag: isVolatile,
        confidence_score: confidence,
        last_updated_at: now.toISOString(),
        is_bye_week: isByeWeek,
        injury_status: currentInjuryStatus,
        injury_duration_weeks: injuryDuration,
      });
    }

    console.log(`Generated ${valuations.length} player valuations for week ${week}`);

    // Get or create normalized player entries
    const sleeperIds = valuations.map(v => v.player_id);
    
    const { data: normPlayers } = await supabase
      .from('normalized_players')
      .select('sleeper_id, player_id, player_name')
      .in('sleeper_id', sleeperIds);

    const normalizedIdMap = new Map<string, string>();
    const existingSleeperIds = new Set<string>();
    
    if (normPlayers) {
      for (const p of normPlayers) {
        if (p.sleeper_id) {
          normalizedIdMap.set(p.sleeper_id, p.player_id);
          existingSleeperIds.add(p.sleeper_id);
        }
      }
    }

    // Create missing normalized entries
    const missingSleeperIds = sleeperIds.filter(id => !existingSleeperIds.has(id));
    if (missingSleeperIds.length > 0) {
      const playersToInsert = missingSleeperIds.map(sleeperId => {
        const valuation = valuations.find(v => v.player_id === sleeperId);
        return {
          player_id: sleeperId,
          sleeper_id: sleeperId,
          player_name: valuation?.player_name || 'Unknown',
          position: valuation?.position || 'FLEX',
          team: valuation?.team || 'FA',
        };
      });

      const { data: inserted } = await supabase
        .from('normalized_players')
        .upsert(playersToInsert, { onConflict: 'sleeper_id', ignoreDuplicates: false })
        .select();

      if (inserted) {
        for (const p of inserted) {
          if (p.sleeper_id) {
            normalizedIdMap.set(p.sleeper_id, p.player_id);
          }
        }
      }
    }

    // Update valuations to use normalized player_id
    const normalizedValuations = valuations.map(v => ({
      ...v,
      player_id: normalizedIdMap.get(v.player_id) || v.player_id,
    }));
    
    // Delete existing valuations for this week/season
    await supabase
      .from('player_valuations')
      .delete()
      .eq('season', currentSeason)
      .eq('week', week);

    // Insert new valuations
    const { error } = await supabase
      .from('player_valuations')
      .insert(normalizedValuations);

    if (error) throw error;

    console.log(`Successfully backfilled ${normalizedValuations.length} player valuations for week ${week}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        count: normalizedValuations.length,
        week: week,
        season: currentSeason 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error backfilling player valuations:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to backfill player valuations' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
