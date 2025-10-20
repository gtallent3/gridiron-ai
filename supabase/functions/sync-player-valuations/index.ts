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

    // 2024-2025 NFL Bye Week Schedule
    const byeWeekSchedule = new Map<string, number>([
      // Week 5
      ['DET', 5], ['LAC', 5], ['PHI', 5], ['TEN', 5],
      // Week 6
      ['KC', 6], ['LAR', 6], ['MIA', 6], ['MIN', 6],
      // Week 7
      ['BUF', 7], ['CHI', 7], ['HOU', 7], ['JAX', 7],
      // Week 9
      ['CLE', 9], ['GB', 9], ['LV', 9], ['PIT', 9], ['SF', 9], ['SEA', 9],
      // Week 10
      ['ARI', 10], ['CAR', 10], ['NYG', 10], ['TB', 10],
      // Week 11
      ['ATL', 11], ['IND', 11], ['NE', 11], ['NO', 11],
      // Week 12
      ['BAL', 12], ['CIN', 12], ['DAL', 12], ['DEN', 12], ['NYJ', 12], ['WAS', 12],
    ]);
    
    console.log(`Loaded bye week schedule for ${byeWeekSchedule.size} teams`);

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

    const valuations: any[] = [];

    // Generate valuations for each week (enables trend analysis)
    for (let targetWeek = 1; targetWeek <= currentWeek; targetWeek++) {
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
        
        // Base ROS projection on actual performance
        let rosProjection = 0;
        if (gamesPlayedUpToTarget >= 3) {
          rosProjection = (avgPointsPerGame * 0.6 + recentAvg * 0.4) * weeksRemaining;
        } else if (gamesPlayedUpToTarget > 0) {
          rosProjection = avgPointsPerGame * 0.8 * weeksRemaining;
        } else {
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
        
        // Calculate schedule difficulty
        const teamRank = defensiveRankings.get(p.team) || 16;
        const scheduleDifficulty = (teamRank - 16) / 32;
        
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
        
        // Injury risk and duration estimation - use current week data for all weeks
        let injuryRisk = 0.05;
        let injuryDuration = 0; // weeks
        let injuryMultiplier = 1.0;
        let currentInjuryStatus = p.injury_status || null;
        
        // Apply injury status from current data (Sleeper keeps this updated)
        if (currentInjuryStatus === 'Out') {
          injuryRisk = 0.9;
          injuryDuration = 1; // Short-term, 1 week
          injuryMultiplier = 0.9; // 10% penalty
          rosProjection *= injuryMultiplier;
        } else if (currentInjuryStatus === 'Doubtful' || currentInjuryStatus === 'D') {
          injuryRisk = 0.7;
          injuryDuration = 1;
          injuryMultiplier = 0.9;
          rosProjection *= injuryMultiplier;
        } else if (currentInjuryStatus === 'Questionable' || currentInjuryStatus === 'Q') {
          injuryRisk = 0.4;
          injuryDuration = 1;
          injuryMultiplier = 0.95; // 5% penalty
          rosProjection *= injuryMultiplier;
        } else if (currentInjuryStatus === 'IR' || currentInjuryStatus === 'PUP') {
          injuryRisk = 1.0;
          injuryDuration = 4; // Long-term, 4+ weeks
          injuryMultiplier = 0.3; // 70% penalty
          rosProjection *= injuryMultiplier;
        }
        
        console.log(`Week ${targetWeek} - ${p.first_name} ${p.last_name}: Team=${p.team}, Bye=${isByeWeek}, Injury=${currentInjuryStatus}`);
        
        // Final player value
        const playerValue = rosProjection * 
          (1 + sentimentScore) * 
          (1 - scheduleDifficulty * 0.15) * 
          (1 + usageTrend);
        
        // Next 3 weeks projection
        const next3WeeksProjection = Math.min(
          avgPointsPerGame > 0 ? recentAvg * 3 : rosProjection * 3 / weeksRemaining,
          rosProjection
        );
        
        // Playoff schedule difficulty
        const playoffDiff = scheduleDifficulty * 1.2;
        
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
          player_name: `${p.first_name} ${p.last_name}`,
          position,
          team: p.team || 'FA',
          season: currentSeason,
          week: targetWeek,
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
          is_bye_week: isByeWeek,
          injury_status: currentInjuryStatus,
          injury_duration_weeks: injuryDuration,
        });
      }
    }

    // Get or create normalized player entries for all Sleeper IDs
    const sleeperIds = valuations.map(v => v.player_id);
    
    // First, try to find existing normalized players by sleeper_id OR by player_name
    const playerNames = valuations.map(v => v.player_name);
    const { data: normPlayers } = await supabase
      .from('normalized_players')
      .select('sleeper_id, player_id, player_name')
      .or(`sleeper_id.in.(${sleeperIds.join(',')}),player_name.in.(${playerNames.map(n => `"${n}"`).join(',')})`);

    const normalizedIdMap = new Map<string, string>();
    const existingSleeperIds = new Set<string>();
    
    if (normPlayers) {
      // Build map: prioritize entries with sleeper_id match
      const sleeperMatches = normPlayers.filter(p => p.sleeper_id && sleeperIds.includes(p.sleeper_id));
      const nameMatches = normPlayers.filter(p => !p.sleeper_id || !sleeperIds.includes(p.sleeper_id));
      
      // Process sleeper ID matches first (these are authoritative)
      for (const p of sleeperMatches) {
        normalizedIdMap.set(p.sleeper_id!, p.player_id);
        existingSleeperIds.add(p.sleeper_id!);
      }
      
      // For name matches without sleeper_id, update them with the sleeper_id
      for (const p of nameMatches) {
        const valuation = valuations.find(v => v.player_name === p.player_name);
        if (valuation) {
          // Update this normalized_player to include the sleeper_id
          await supabase
            .from('normalized_players')
            .update({ sleeper_id: valuation.player_id })
            .eq('player_id', p.player_id);
          
          normalizedIdMap.set(valuation.player_id, p.player_id);
          existingSleeperIds.add(valuation.player_id);
        }
      }
    }

    // Create missing normalized entries
    const missingSleeperIds = sleeperIds.filter(id => !existingSleeperIds.has(id));
    if (missingSleeperIds.length > 0) {
      const playersToInsert = missingSleeperIds.map(sleeperId => {
        const valuation = valuations.find(v => v.player_id === sleeperId);
        return {
          player_id: sleeperId, // Use sleeper_id as normalized player_id
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

      // Update the map with newly inserted players
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
    
    // Delete old duplicate entries before upserting (cleanup)
    for (const v of normalizedValuations) {
      await supabase
        .from('player_valuations')
        .delete()
        .eq('season', v.season)
        .eq('week', v.week)
        .neq('player_id', v.player_id)
        .ilike('player_name', v.player_name);
    }

    // Upsert valuations
    const { error } = await supabase
      .from('player_valuations')
      .upsert(normalizedValuations, { 
        onConflict: 'player_id,season,week',
        ignoreDuplicates: false 
      });

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
