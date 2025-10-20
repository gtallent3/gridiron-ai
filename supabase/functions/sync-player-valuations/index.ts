import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};

// Weekly CRON job to update player valuations with real data
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting weekly player valuation sync...');

    const now = new Date();
    // Calculate current week based on 2025 NFL season start (typically early September)
    const seasonStart = new Date(2025, 8, 5); // September 5, 2025 (month is 0-indexed)
    const weeksSinceStart = Math.floor((now.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
    const currentWeek = Math.min(Math.max(weeksSinceStart + 1, 1), 18);
    const currentSeason = 2025;

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
      // Week 5
      ['ATL', 5], ['CHI', 5], ['GB', 5], ['PIT', 5],
      // Week 6
      ['HOU', 6], ['MIN', 6],
      // Week 7
      ['BAL', 7], ['BUF', 7],
      // Week 8
      ['ARI', 8], ['DET', 8], ['JAX', 8], ['LV', 8], ['LAR', 8], ['SEA', 8],
      // Week 9
      ['CLE', 9], ['NYJ', 9], ['PHI', 9], ['TB', 9],
      // Week 10
      ['CIN', 10], ['DAL', 10], ['KC', 10], ['TEN', 10],
      // Week 11
      ['IND', 11], ['NO', 11],
      // Week 12
      ['DEN', 12], ['LAC', 12], ['MIA', 12], ['WAS', 12],
      // Week 14
      ['CAR', 14], ['NE', 14], ['NYG', 14], ['SF', 14],
    ]);
    
    console.log(`Loaded bye week schedule for ${byeWeekSchedule.size} teams for 2025-26 season`);

    // Fetch player stats for current season
    const statsPromises = [];
    for (let week = 1; week <= currentWeek; week++) {
      statsPromises.push(
        fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${currentSeason}/${week}`).then(r => r.json())
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
        
        // Store detailed stats for context
        playerStat.lastStats = stats;
      });
    });

    // Position-specific defensive rankings (1 = best defense vs position, higher = worse)
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

    // Team offensive context (pace, pass rate, red zone efficiency)
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

    // Default team context for teams not in top tier
    const defaultContext = { pace: 1.0, passRate: 0.57, rzEff: 1.0 };

    // NFL Schedule 2025-26 Season - Each team has EXACTLY ONE bye week
    // Array index represents week number (index 0 = week 1, index 1 = week 2, etc.)
    const nflSchedule = new Map([
      // AFC East
      ['BUF', ['ARI', 'MIA', 'JAX', 'BAL', 'HOU', 'NYJ', null, 'TEN', 'MIA', 'IND', 'KC', 'SF', 'DET', 'LAC', 'NE', 'NYJ', 'NE', 'MIA']],
      ['MIA', ['JAX', 'BUF', 'CLE', 'TEN', 'NE', 'CAR', 'IND', 'ARI', 'BUF', 'LAR', 'LV', null, 'NYJ', 'HOU', 'SF', 'CLE', 'NYJ', 'NE']],
      ['NE', ['CIN', 'SEA', 'NYJ', 'SF', 'MIA', 'HOU', 'JAX', 'NYG', 'TEN', 'CHI', 'LAR', 'MIA', 'IND', null, 'BUF', 'LAC', 'BUF', 'WAS']],
      ['NYJ', ['SF', 'TEN', 'NE', 'DEN', 'MIN', null, 'PIT', 'NE', 'HOU', 'ARI', 'IND', 'SEA', 'MIA', 'JAX', 'LAR', 'BUF', 'MIA', 'CLE']],
      
      // AFC North
      ['BAL', ['KC', 'LV', 'DAL', 'BUF', 'CIN', 'WAS', null, 'CLE', 'DEN', 'CIN', 'PIT', 'PHI', 'NYG', 'PIT', 'HOU', 'CLE', 'CIN', 'PIT']],
      ['CIN', ['NE', 'KC', 'WAS', 'PHI', 'BAL', 'NYG', 'CLE', null, 'LV', 'BAL', 'LAC', 'PIT', 'DAL', 'TEN', 'CLE', 'DEN', 'PIT', 'BAL']],
      ['CLE', ['DAL', 'NO', 'NYG', 'LV', 'WAS', 'PHI', 'CIN', 'BAL', null, 'ARI', 'NO', 'PIT', 'KC', 'PIT', 'CIN', 'MIA', 'BAL', 'NYJ']],
      ['PIT', ['ATL', 'KC', 'LAC', 'IND', 'DAL', 'LV', 'NYJ', 'NYG', null, 'PHI', 'BAL', 'CLE', 'CIN', 'BAL', 'PHI', 'KC', 'CIN', 'BAL']],
      
      // AFC South
      ['HOU', ['IND', 'CHI', 'MIN', 'JAX', null, 'NE', 'GB', 'IND', 'NYJ', 'DET', 'DAL', 'JAX', 'TEN', 'MIA', 'KC', 'BAL', 'TEN', 'IND']],
      ['IND', ['HOU', 'GB', 'CHI', 'PIT', 'JAX', 'TEN', 'MIA', 'HOU', 'MIN', 'BUF', null, 'DET', 'NE', 'DEN', 'TEN', 'NYG', 'JAX', 'HOU']],
      ['JAX', ['MIA', 'CLE', 'BUF', 'HOU', null, 'CHI', 'NE', 'GB', 'PHI', 'MIN', 'DET', 'HOU', 'TEN', 'NYJ', 'LV', 'IND', 'TEN', 'IND']],
      ['TEN', ['CHI', 'NYJ', 'GB', 'MIA', null, 'IND', 'BUF', 'DET', 'NE', 'LAC', 'MIN', 'CIN', 'JAX', null, 'IND', 'JAX', 'HOU', 'JAX']],
      
      // AFC West
      ['DEN', ['NYG', 'NO', 'PIT', 'NYJ', 'LV', 'LAC', 'NO', 'CAR', 'BAL', 'KC', 'ATL', null, 'LV', 'IND', 'LAC', 'CIN', 'KC', 'LAC']],
      ['KC', ['BAL', 'PIT', 'ATL', 'LAC', 'NO', 'SF', null, 'LV', 'TB', 'DEN', 'BUF', 'CAR', 'CLE', 'DEN', 'HOU', 'PIT', 'DEN', 'LV']],
      ['LV', ['LAC', 'BAL', 'CAR', 'CLE', 'DEN', 'PIT', 'ARI', null, 'CIN', 'KC', 'MIA', 'DEN', 'ATL', 'TB', 'NO', 'JAX', 'NO', 'KC']],
      ['LAC', ['LV', 'ARI', null, 'KC', 'ARI', 'DEN', 'ARI', 'CAR', 'CLE', 'TEN', 'CIN', 'ATL', 'TB', 'BUF', 'DEN', 'NE', 'LV', 'DEN']],
      
      // NFC East
      ['DAL', ['CLE', 'ARI', 'NO', 'NYG', 'PIT', 'DET', null, 'SF', 'PHI', null, 'HOU', 'WAS', 'CIN', 'NYG', 'CAR', 'TB', 'PHI', 'NYG']],
      ['NYG', ['DEN', 'WAS', 'CLE', 'DAL', 'SEA', 'CIN', 'PHI', 'PIT', null, 'WAS', 'TB', 'CAR', 'BAL', null, 'ATL', 'IND', 'WAS', 'PHI']],
      ['PHI', ['GB', 'ATL', 'SF', 'CIN', null, 'CLE', 'NYG', null, 'JAX', 'PIT', 'WAS', 'BAL', 'CAR', 'DAL', 'WAS', 'DAL', 'NYG', 'WAS']],
      ['WAS', ['TB', 'NYG', 'CIN', 'ARI', 'CLE', 'BAL', 'CAR', 'CHI', 'PIT', 'NYG', 'PHI', null, 'NO', 'CAR', null, 'ATL', 'PHI', 'NYG']],
      
      // NFC North
      ['CHI', ['TEN', 'HOU', 'IND', 'LAR', null, 'JAX', 'CAR', 'WAS', 'ARI', null, 'GB', 'MIN', 'SEA', 'MIN', 'DET', 'SEA', 'GB', 'MIN']],
      ['DET', ['LAR', 'TB', 'GB', null, 'ARI', 'SEA', 'MIN', 'TEN', 'GB', null, 'JAX', 'IND', 'BUF', 'GB', 'CHI', 'GB', 'SF', 'MIN']],
      ['GB', ['PHI', 'IND', null, 'MIN', 'DET', null, 'ARI', 'HOU', 'JAX', 'DET', 'CHI', null, 'SEA', 'MIN', 'DET', 'SEA', 'NO', 'MIN']],
      ['MIN', ['SF', 'ATL', 'HOU', null, 'NYJ', 'GB', 'DET', 'LAR', null, 'JAX', 'TEN', 'CHI', 'GB', null, 'SEA', 'CHI', 'GB', 'DET']],
      
      // NFC South
      ['ATL', ['PIT', 'PHI', 'KC', null, 'TB', 'CAR', 'SEA', null, 'TB', null, 'NO', 'DEN', 'LAC', 'LV', 'CAR', 'NYG', 'WAS', 'NO']],
      ['CAR', ['NO', 'TB', 'LV', 'ATL', null, 'MIA', 'WAS', null, 'DEN', 'NO', null, 'KC', 'PHI', null, 'WAS', 'DAL', 'TB', 'ATL']],
      ['NO', ['CAR', 'DEN', 'DAL', 'SEA', null, 'KC', 'TB', 'DEN', 'CAR', null, 'ATL', 'CLE', 'LAR', 'WAS', null, 'LV', 'GB', 'TB']],
      ['TB', ['WAS', 'DET', 'CAR', null, 'PHI', 'ATL', null, 'NO', 'ATL', 'KC', null, 'NYG', 'LAC', 'CAR', 'LV', 'DAL', 'NO', 'ATL']],
      
      // NFC West
      ['ARI', ['BUF', 'LAC', null, 'LAR', 'SF', 'LAC', 'LV', 'GB', 'MIA', 'SEA', 'CLE', 'NYJ', null, 'SEA', 'SF', null, 'LAR', 'SF']],
      ['LAR', ['DET', 'CHI', 'ARI', null, 'LAC', 'SF', null, 'LV', 'MIN', 'SEA', 'MIA', 'PHI', 'NO', 'ARI', 'SF', null, 'NYJ', 'ARI']],
      ['SF', ['MIN', 'DAL', null, 'PHI', 'NE', 'ARI', 'LAR', 'KC', 'DAL', null, 'ARI', 'SEA', null, 'BUF', 'LAR', 'ARI', 'MIA', 'DET']],
      ['SEA', ['DEN', null, 'NE', 'MIA', 'DET', 'NYG', null, 'ATL', 'DET', 'ARI', 'LAM', 'SF', 'GB', 'ARI', null, 'MIN', 'CHI', 'LAR']],
    ]);

    // Get position-specific defensive multiplier
    const getDefensiveMultiplier = (opponent: string | null, position: string): number => {
      if (!opponent) return 1.0; // Bye week
      
      let defMap: Map<string, number>;
      if (position === 'QB') defMap = defensiveRankings.vsQB;
      else if (position === 'RB') defMap = defensiveRankings.vsRB;
      else if (position === 'TE') defMap = defensiveRankings.vsTE;
      else defMap = defensiveRankings.vsWR; // WR and others default to WR defense
      
      const rank = defMap.get(opponent) || 16; // Default to middle-tier defense
      // Scale: rank 1 (best defense) = 0.85x, rank 32 (worst) = 1.15x
      return 1.0 - ((rank - 16.5) * 0.01);
    };

    // Build filtered entries for active and relevant players (exclude retired/inactive)
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

    // Generate valuations only for the current week to keep the function fast and reliable
    const targetWeek = currentWeek;
    console.log(`Processing valuations for week ${targetWeek}...`);
    
    for (const [playerId, player] of playerEntries) {
      const p = player as any;
      const position = p.fantasy_positions[0];
      const stats = playerStats.get(playerId);
      const weeksRemaining = Math.max(18 - targetWeek, 1);
      
      // Calculate stats up to target week
      const weeklyPointsUpToTarget = stats?.weeklyPoints.slice(0, targetWeek) || [];
      const gamesPlayedUpToTarget = weeklyPointsUpToTarget.filter((pts: number) => pts > 0).length;
      const totalPointsUpToTarget = weeklyPointsUpToTarget.reduce((sum: number, pts: number) => sum + pts, 0);
      const avgPointsPerGame = gamesPlayedUpToTarget > 0 ? totalPointsUpToTarget / gamesPlayedUpToTarget : 0;
      
      const recentForm = weeklyPointsUpToTarget.slice(-3);
      const recentAvg = recentForm.length > 0 ? recentForm.reduce((a: number, b: number) => a + b, 0) / recentForm.length : avgPointsPerGame;
      
      // Calculate variance for volatility
      const variance = weeklyPointsUpToTarget.length > 0 
        ? weeklyPointsUpToTarget.reduce((acc: number, pts: number) => acc + Math.pow(pts - avgPointsPerGame, 2), 0) / weeklyPointsUpToTarget.length
        : 0;
      const standardDev = Math.sqrt(variance);
      
      // Calculate base PPG projection
      let basePpgProjection = 0;
      if (gamesPlayedUpToTarget >= 3) {
        basePpgProjection = avgPointsPerGame * 0.6 + recentAvg * 0.4;
      } else if (gamesPlayedUpToTarget > 0) {
        basePpgProjection = avgPointsPerGame * 0.8;
      } else {
        const baselines = { QB: 18, RB: 12, WR: 11, TE: 8, K: 7, DEF: 8 };
        basePpgProjection = baselines[position as keyof typeof baselines] || 10;
      }
      
      // Apply team context multiplier to base PPG
      const context = teamContext.get(p.team) || defaultContext;
      let teamMultiplier = 1.0;
      
      if (position === 'QB') {
        teamMultiplier = context.pace * (1 + (context.passRate - 0.57) * 0.5);
      } else if (position === 'RB') {
        teamMultiplier = context.pace * (1 + (0.57 - context.passRate) * 0.3) * context.rzEff;
      } else if (position === 'WR' || position === 'TE') {
        teamMultiplier = context.pace * (1 + (context.passRate - 0.57) * 0.4) * (context.rzEff * 0.8);
      }
      
      const adjustedBasePpg = basePpgProjection * teamMultiplier;
      
      // Week-by-week ROS projection with matchup analysis
      const teamSchedule = nflSchedule.get(p.team) || [];
      let rosProjection = 0;
      let championshipWeeksProjection = 0;
      let remainingByeWeeks = 0;
      let next3WeeksTotal = 0;
      const weeklyProjections: any[] = [];
      
      for (let week = targetWeek; week <= 18; week++) {
        const weekIndex = week - 1;
        const opponent = teamSchedule[weekIndex];
        
        // Check if bye week
        if (opponent === null || opponent === undefined) {
          remainingByeWeeks++;
          weeklyProjections.push({ week, opponent: null, projection: 0, isBye: true });
          continue;
        }
        
        // Calculate week projection with opponent adjustment
        const defenseMultiplier = getDefensiveMultiplier(opponent, position);
        
        // Home/away adjustment (simplified: assume alternating, slight home advantage)
        const homeAwayMultiplier = week % 2 === 0 ? 1.02 : 0.98;
        
        let weekProjection = adjustedBasePpg * defenseMultiplier * homeAwayMultiplier;
        
        // Playoff week bonus (weeks 15-17 for championship relevance)
        if (week >= 15 && week <= 17) {
          weekProjection *= 1.1; // 10% bonus for championship weeks
          championshipWeeksProjection += weekProjection;
        }
        
        rosProjection += weekProjection;
        
        // Track next 3 weeks
        if (week < targetWeek + 3) {
          next3WeeksTotal += weekProjection;
        }
        
        weeklyProjections.push({ 
          week, 
          opponent, 
          projection: Math.round(weekProjection * 10) / 10,
          isBye: false 
        });
      }
      
      // Enhanced sentiment scoring
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
      if (stats?.lastStats && targetWeek === currentWeek) {
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
      
      // Bye week detection - check if team has a bye this week
      const teamByeWeek = byeWeekSchedule.get(p.team);
      const isByeWeek = teamByeWeek === targetWeek;
      
      // Injury risk and duration estimation
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
      
      // Apply injury multiplier to projections
      rosProjection *= injuryMultiplier;
      championshipWeeksProjection *= injuryMultiplier;
      next3WeeksTotal *= injuryMultiplier;
      
      // Apply overall adjustments for final player value
      const next3WeeksProjection = next3WeeksTotal;
      const sentimentMultiplier = (1 + Math.max(-0.3, Math.min(0.3, sentimentScore)));
      const usageTrendMultiplier = (1 + usageTrend);
      
      const playerValue = rosProjection * sentimentMultiplier * usageTrendMultiplier;
      
      // Calculate schedule strength metrics
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
      
      // Calculate schedule-adjusted PPG
      const availableWeeks = 18 - targetWeek - remainingByeWeeks;
      const ppgProjection = availableWeeks > 0 ? rosProjection / availableWeeks : basePpgProjection;
      
      console.log(`Week ${targetWeek} - ${p.first_name} ${p.last_name}: Team=${p.team}, Bye=${isByeWeek}, Injury=${currentInjuryStatus}`);
      
      // Volatility flag
      const isVolatile = injuryRisk > 0.3 || roleStability < 0.6 || standardDev > avgPointsPerGame * 0.6;
      
      // Confidence score
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
        week: targetWeek,
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

    // Get or create normalized player entries for all Sleeper IDs
    const sleeperIds = valuations.map(v => v.player_id);
    
    // Find existing normalized players by sleeper_id only (most reliable)
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
    
    // Delete any existing valuations for this week/season before upserting to prevent duplicates
    await supabase
      .from('player_valuations')
      .delete()
      .eq('season', currentSeason)
      .eq('week', targetWeek);

    // Upsert valuations
    const { error } = await supabase
      .from('player_valuations')
      .insert(normalizedValuations);

    if (error) throw error;

    console.log(`Successfully synced ${normalizedValuations.length} player valuations for Week ${currentWeek}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        count: normalizedValuations.length,
        week: currentWeek,
        season: currentSeason 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error syncing player valuations:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to sync player valuations' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
