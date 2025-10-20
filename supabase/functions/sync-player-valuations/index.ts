import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Weekly CRON job to update player valuations with real data
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting weekly player valuation sync...');

    const now = new Date();
    const currentWeek = Math.min(Math.floor((now.getTime() - new Date(now.getFullYear(), 8, 1).getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1, 18);
    const currentSeason = now.getFullYear();

    // Fetch all required data in parallel
    const [sleeperPlayers, trending, nflState] = await Promise.all([
      fetch('https://api.sleeper.app/v1/players/nfl').then(r => r.json()),
      fetch('https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=168&limit=200').then(r => r.json()),
      fetch(`https://api.sleeper.app/v1/state/nfl`).then(r => r.json())
    ]);
    
    const trendingIds = new Set(trending.map((t: any) => t.player_id));
    const trendingCountMap = new Map(trending.map((t: any) => [t.player_id, t.count || 1]));

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

    // NFL Defensive Rankings (based on points allowed per game - lower is better defense)
    const defensiveRankings = new Map([
      ['BAL', 1], ['SF', 2], ['BUF', 3], ['CLE', 4], ['DAL', 5],
      ['NYJ', 6], ['MIA', 7], ['PIT', 8], ['DEN', 9], ['NO', 10],
      ['KC', 11], ['PHI', 12], ['DET', 13], ['TB', 14], ['LAC', 15],
      ['LV', 16], ['SEA', 17], ['MIN', 18], ['IND', 19], ['JAX', 20],
      ['GB', 21], ['TEN', 22], ['CIN', 23], ['HOU', 24], ['NYG', 25],
      ['NE', 26], ['ATL', 27], ['LAR', 28], ['CHI', 29], ['WAS', 30],
      ['ARI', 31], ['CAR', 32]
    ]);

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

    // Process top ~200 fantasy relevant players
    const playerEntries = Object.entries(sleeperPlayers).filter(([_, player]: [string, any]) => {
      return player.fantasy_positions && 
             player.fantasy_positions.length > 0 &&
             ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(player.fantasy_positions[0]) &&
             player.team;
    }).slice(0, 200);

    const valuations = [];

    for (const [playerId, player] of playerEntries) {
      const p = player as any;
      const position = p.fantasy_positions[0];
      const stats = playerStats.get(playerId);
      const weeksRemaining = Math.max(18 - currentWeek, 1);
      
      // Get actual performance data
      const avgPointsPerGame = stats ? (stats.totalPoints / Math.max(stats.gamesPlayed, 1)) : 0;
      const gamesPlayed = stats?.gamesPlayed || 0;
      const recentForm = stats?.weeklyPoints.slice(-3) || [];
      const recentAvg = recentForm.length > 0 ? recentForm.reduce((a: number, b: number) => a + b, 0) / recentForm.length : avgPointsPerGame;
      
      // Calculate variance for volatility
      const variance = stats?.weeklyPoints.length > 0 
        ? stats.weeklyPoints.reduce((acc: number, pts: number) => acc + Math.pow(pts - avgPointsPerGame, 2), 0) / stats.weeklyPoints.length
        : 0;
      const standardDev = Math.sqrt(variance);
      
      // Base ROS projection on actual performance
      let rosProjection = 0;
      if (gamesPlayed >= 3) {
        // Use weighted average: 60% season avg, 40% recent form
        rosProjection = (avgPointsPerGame * 0.6 + recentAvg * 0.4) * weeksRemaining;
      } else if (gamesPlayed > 0) {
        // Less data, be more conservative
        rosProjection = avgPointsPerGame * 0.8 * weeksRemaining;
      } else {
        // No data, use position baseline
        const baselines = { QB: 18, RB: 12, WR: 11, TE: 8, K: 7, DEF: 8 };
        rosProjection = (baselines[position as keyof typeof baselines] || 10) * weeksRemaining;
      }
      
      // Team context adjustments
      const context = teamContext.get(p.team) || defaultContext;
      let teamMultiplier = 1.0;
      
      if (position === 'QB') {
        teamMultiplier = context.pace * (1 + (context.passRate - 0.57) * 0.5);
      } else if (position === 'RB') {
        teamMultiplier = context.pace * (1 + (0.57 - context.passRate) * 0.3) * context.rzEff;
      } else if (position === 'WR' || position === 'TE') {
        teamMultiplier = context.pace * (1 + (context.passRate - 0.57) * 0.4) * (context.rzEff * 0.8);
      }
      
      rosProjection *= teamMultiplier;
      
      // Calculate schedule difficulty based on defensive rankings
      const teamRank = defensiveRankings.get(p.team) || 16;
      const scheduleDifficulty = (teamRank - 16) / 32; // Normalized -0.5 to 0.5
      
      // Enhanced sentiment scoring based on trending volume and recency
      let sentimentScore = 0;
      if (trendingIds.has(playerId)) {
        const trendCount = Number(trendingCountMap.get(playerId) || 1);
        // More adds = higher sentiment (max +0.25)
        sentimentScore = Math.min(0.25, 0.05 + (trendCount / 100) * 0.2);
      } else if (gamesPlayed > 0 && recentAvg > avgPointsPerGame * 1.2) {
        // Recent performance bump without trending
        sentimentScore = 0.08;
      } else {
        sentimentScore = -0.03; // Slight negative for non-trending
      }
      
      // Usage trend based on actual snap/target/carry data
      let usageTrend = 0;
      if (stats?.lastStats) {
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
      
      // Role stability based on consistency and volume
      let roleStability = 0.5;
      if (gamesPlayed >= 6) {
        const consistency = standardDev > 0 ? 1 - Math.min(standardDev / avgPointsPerGame, 1) : 0.5;
        const volumeStability = p.years_exp > 3 ? 0.9 : p.years_exp > 1 ? 0.7 : 0.5;
        roleStability = (consistency * 0.6 + volumeStability * 0.4);
      } else if (gamesPlayed > 0) {
        roleStability = 0.6;
      }
      
      // Injury risk assessment
      let injuryRisk = 0.05; // Baseline
      if (p.injury_status === 'Out') {
        injuryRisk = 0.9;
        rosProjection *= 0.1;
      } else if (p.injury_status === 'Doubtful') {
        injuryRisk = 0.7;
        rosProjection *= 0.3;
      } else if (p.injury_status === 'Questionable') {
        injuryRisk = 0.4;
        rosProjection *= 0.7;
      } else if (p.injury_status === 'IR') {
        injuryRisk = 1.0;
        rosProjection *= 0.05;
      }
      
      // Final player value calculation with all factors
      const playerValue = rosProjection * 
        (1 + sentimentScore) * 
        (1 - scheduleDifficulty * 0.15) * 
        (1 + usageTrend);
      
      // Next 3 weeks projection (near-term value)
      const next3WeeksProjection = Math.min(
        avgPointsPerGame > 0 ? recentAvg * 3 : rosProjection * 3 / weeksRemaining,
        rosProjection
      );
      
      // Playoff schedule difficulty (weeks 15-17)
      const playoffDiff = scheduleDifficulty * 1.2; // Amplify for playoff implications
      
      // Volatility flag based on consistency
      const isVolatile = injuryRisk > 0.3 || roleStability < 0.6 || standardDev > avgPointsPerGame * 0.6;
      
      // Confidence score (0-100)
      const confidence = Math.round(
        Math.max(0, Math.min(100,
          50 + // Base
          (gamesPlayed * 3) + // More games = more confidence
          (roleStability * 25) + // Stable role adds confidence
          (sentimentScore * 40) - // Positive sentiment helps
          (injuryRisk * 30) - // Injury risk reduces confidence
          (standardDev > avgPointsPerGame * 0.5 ? 15 : 0) // High variance reduces confidence
        ))
      );

      valuations.push({
        player_id: playerId,
        player_name: `${p.first_name} ${p.last_name}`,
        position,
        team: p.team || 'FA',
        season: currentSeason,
        week: currentWeek,
        player_value: Math.round(playerValue * 10) / 10,
        ros_projection: Math.round(rosProjection * 10) / 10,
        next_3_weeks_projection: Math.round(next3WeeksProjection * 10) / 10,
        schedule_difficulty: Math.round(scheduleDifficulty * 100) / 100,
        sentiment_score: Math.round(sentimentScore * 100) / 100,
        usage_trend: Math.round(usageTrend * 100) / 100,
        role_stability: Math.round(roleStability * 100) / 100,
        injury_risk: Math.round(injuryRisk * 100) / 100,
        volatility_flag: isVolatile,
        confidence_score: confidence,
        playoff_schedule_difficulty: Math.round(playoffDiff * 100) / 100,
        last_updated_at: now.toISOString(),
      });
    }

    // Upsert valuations
    const { error } = await supabase
      .from('player_valuations')
      .upsert(valuations, { 
        onConflict: 'player_id,season,week',
        ignoreDuplicates: false 
      });

    if (error) throw error;

    console.log(`Successfully synced ${valuations.length} player valuations for Week ${currentWeek}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        count: valuations.length,
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
