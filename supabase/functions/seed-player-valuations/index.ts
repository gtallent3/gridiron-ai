import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Sample player valuations for testing - Top 100 players
const PLAYER_DATA = [
  // Elite QBs
  { player_id: 'mahomes', name: 'Patrick Mahomes', position: 'QB', team: 'KC', ros_projection: 285, next_3: 52, usage_trend: 0.1, role_stability: 1.0, injury_risk: 0.0, schedule_difficulty: -0.1, playoff_schedule: -0.2, sentiment: 0.3, volatility: false },
  { player_id: 'allen', name: 'Josh Allen', position: 'QB', team: 'BUF', ros_projection: 280, next_3: 51, usage_trend: 0.2, role_stability: 1.0, injury_risk: 0.1, schedule_difficulty: 0.0, playoff_schedule: -0.1, sentiment: 0.4, volatility: false },
  { player_id: 'hurts', name: 'Jalen Hurts', position: 'QB', team: 'PHI', ros_projection: 275, next_3: 50, usage_trend: 0.0, role_stability: 1.0, injury_risk: 0.1, schedule_difficulty: 0.1, playoff_schedule: 0.0, sentiment: 0.2, volatility: false },
  { player_id: 'jackson', name: 'Lamar Jackson', position: 'QB', team: 'BAL', ros_projection: 270, next_3: 49, usage_trend: 0.1, role_stability: 1.0, injury_risk: 0.2, schedule_difficulty: -0.05, playoff_schedule: -0.15, sentiment: 0.3, volatility: false },
  { player_id: 'burrow', name: 'Joe Burrow', position: 'QB', team: 'CIN', ros_projection: 260, next_3: 47, usage_trend: 0.0, role_stability: 0.9, injury_risk: 0.1, schedule_difficulty: 0.0, playoff_schedule: 0.0, sentiment: 0.1, volatility: false },
  
  // Elite RBs
  { player_id: 'mccaffrey', name: 'Christian McCaffrey', position: 'RB', team: 'SF', ros_projection: 240, next_3: 45, usage_trend: 0.3, role_stability: 1.0, injury_risk: 0.2, schedule_difficulty: -0.2, playoff_schedule: -0.25, sentiment: 0.5, volatility: false },
  { player_id: 'bijan', name: 'Bijan Robinson', position: 'RB', team: 'ATL', ros_projection: 220, next_3: 42, usage_trend: 0.4, role_stability: 1.0, injury_risk: 0.0, schedule_difficulty: -0.1, playoff_schedule: -0.2, sentiment: 0.6, volatility: false },
  { player_id: 'breece', name: 'Breece Hall', position: 'RB', team: 'NYJ', ros_projection: 210, next_3: 40, usage_trend: 0.2, role_stability: 0.9, injury_risk: 0.1, schedule_difficulty: 0.0, playoff_schedule: 0.1, sentiment: 0.3, volatility: false },
  { player_id: 'chubb', name: 'Nick Chubb', position: 'RB', team: 'CLE', ros_projection: 200, next_3: 38, usage_trend: 0.1, role_stability: 0.9, injury_risk: 0.3, schedule_difficulty: 0.1, playoff_schedule: 0.0, sentiment: 0.2, volatility: false },
  { player_id: 'gibbs', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', ros_projection: 195, next_3: 37, usage_trend: 0.5, role_stability: 0.8, injury_risk: 0.0, schedule_difficulty: -0.15, playoff_schedule: -0.2, sentiment: 0.7, volatility: false },
  { player_id: 'kamara', name: 'Alvin Kamara', position: 'RB', team: 'NO', ros_projection: 185, next_3: 35, usage_trend: 0.0, role_stability: 0.9, injury_risk: 0.2, schedule_difficulty: 0.05, playoff_schedule: 0.1, sentiment: 0.0, volatility: false },
  { player_id: 'cook', name: 'Dalvin Cook', position: 'RB', team: 'NYJ', ros_projection: 170, next_3: 32, usage_trend: -0.2, role_stability: 0.7, injury_risk: 0.2, schedule_difficulty: 0.1, playoff_schedule: 0.1, sentiment: -0.2, volatility: true },
  { player_id: 'etienne', name: 'Travis Etienne', position: 'RB', team: 'JAX', ros_projection: 175, next_3: 33, usage_trend: 0.1, role_stability: 0.8, injury_risk: 0.1, schedule_difficulty: 0.0, playoff_schedule: 0.05, sentiment: 0.1, volatility: false },
  
  // Elite WRs  
  { player_id: 'jefferson', name: 'Justin Jefferson', position: 'WR', team: 'MIN', ros_projection: 230, next_3: 44, usage_trend: 0.2, role_stability: 1.0, injury_risk: 0.1, schedule_difficulty: -0.1, playoff_schedule: -0.15, sentiment: 0.4, volatility: false },
  { player_id: 'lamb', name: 'CeeDee Lamb', position: 'WR', team: 'DAL', ros_projection: 225, next_3: 43, usage_trend: 0.3, role_stability: 1.0, injury_risk: 0.0, schedule_difficulty: -0.05, playoff_schedule: -0.1, sentiment: 0.5, volatility: false },
  { player_id: 'chase', name: "Ja'Marr Chase", position: 'WR', team: 'CIN', ros_projection: 220, next_3: 42, usage_trend: 0.2, role_stability: 1.0, injury_risk: 0.1, schedule_difficulty: 0.0, playoff_schedule: 0.0, sentiment: 0.3, volatility: false },
  { player_id: 'hill', name: 'Tyreek Hill', position: 'WR', team: 'MIA', ros_projection: 215, next_3: 41, usage_trend: 0.1, role_stability: 1.0, injury_risk: 0.0, schedule_difficulty: -0.15, playoff_schedule: -0.2, sentiment: 0.4, volatility: false },
  { player_id: 'adams', name: 'Davante Adams', position: 'WR', team: 'LV', ros_projection: 200, next_3: 38, usage_trend: 0.0, role_stability: 0.9, injury_risk: 0.1, schedule_difficulty: 0.1, playoff_schedule: 0.05, sentiment: 0.1, volatility: false },
  { player_id: 'diggs', name: 'Stefon Diggs', position: 'WR', team: 'BUF', ros_projection: 195, next_3: 37, usage_trend: -0.1, role_stability: 0.9, injury_risk: 0.1, schedule_difficulty: 0.0, playoff_schedule: -0.1, sentiment: 0.0, volatility: false },
  { player_id: 'brown_aj', name: 'A.J. Brown', position: 'WR', team: 'PHI', ros_projection: 210, next_3: 40, usage_trend: 0.2, role_stability: 1.0, injury_risk: 0.2, schedule_difficulty: 0.1, playoff_schedule: 0.0, sentiment: 0.2, volatility: false },
  { player_id: 'evans', name: 'Mike Evans', position: 'WR', team: 'TB', ros_projection: 185, next_3: 35, usage_trend: 0.1, role_stability: 0.9, injury_risk: 0.1, schedule_difficulty: 0.05, playoff_schedule: 0.1, sentiment: 0.2, volatility: false },
  { player_id: 'aiyuk', name: 'Brandon Aiyuk', position: 'WR', team: 'SF', ros_projection: 180, next_3: 34, usage_trend: 0.3, role_stability: 0.9, injury_risk: 0.0, schedule_difficulty: -0.2, playoff_schedule: -0.25, sentiment: 0.6, volatility: false },
  { player_id: 'smith', name: 'DeVonta Smith', position: 'WR', team: 'PHI', ros_projection: 175, next_3: 33, usage_trend: 0.2, role_stability: 0.9, injury_risk: 0.0, schedule_difficulty: 0.1, playoff_schedule: 0.0, sentiment: 0.3, volatility: false },
  
  // Elite TEs
  { player_id: 'kelce', name: 'Travis Kelce', position: 'TE', team: 'KC', ros_projection: 180, next_3: 34, usage_trend: 0.0, role_stability: 1.0, injury_risk: 0.1, schedule_difficulty: -0.1, playoff_schedule: -0.2, sentiment: 0.2, volatility: false },
  { player_id: 'andrews', name: 'Mark Andrews', position: 'TE', team: 'BAL', ros_projection: 165, next_3: 31, usage_trend: 0.1, role_stability: 0.9, injury_risk: 0.2, schedule_difficulty: -0.05, playoff_schedule: -0.15, sentiment: 0.1, volatility: false },
  { player_id: 'laporta', name: 'Sam LaPorta', position: 'TE', team: 'DET', ros_projection: 160, next_3: 30, usage_trend: 0.4, role_stability: 0.9, injury_risk: 0.0, schedule_difficulty: -0.15, playoff_schedule: -0.2, sentiment: 0.5, volatility: false },
  { player_id: 'hockenson', name: 'T.J. Hockenson', position: 'TE', team: 'MIN', ros_projection: 155, next_3: 29, usage_trend: 0.2, role_stability: 0.9, injury_risk: 0.2, schedule_difficulty: -0.1, playoff_schedule: -0.15, sentiment: 0.2, volatility: false },
  { player_id: 'kittle', name: 'George Kittle', position: 'TE', team: 'SF', ros_projection: 150, next_3: 28, usage_trend: 0.1, role_stability: 0.9, injury_risk: 0.2, schedule_difficulty: -0.2, playoff_schedule: -0.25, sentiment: 0.1, volatility: false },
  
  // More QBs
  { player_id: 'stroud', name: 'C.J. Stroud', position: 'QB', team: 'HOU', ros_projection: 255, next_3: 46, usage_trend: 0.5, role_stability: 1.0, injury_risk: 0.0, schedule_difficulty: 0.0, playoff_schedule: -0.1, sentiment: 0.7, volatility: false },
  { player_id: 'dak', name: 'Dak Prescott', position: 'QB', team: 'DAL', ros_projection: 245, next_3: 44, usage_trend: 0.1, role_stability: 0.9, injury_risk: 0.1, schedule_difficulty: -0.05, playoff_schedule: -0.1, sentiment: 0.2, volatility: false },
  { player_id: 'tua', name: 'Tua Tagovailoa', position: 'QB', team: 'MIA', ros_projection: 240, next_3: 43, usage_trend: 0.2, role_stability: 0.9, injury_risk: 0.3, schedule_difficulty: -0.15, playoff_schedule: -0.2, sentiment: 0.3, volatility: true },
  
  // More RBs
  { player_id: 'montgomery', name: 'David Montgomery', position: 'RB', team: 'DET', ros_projection: 165, next_3: 31, usage_trend: 0.1, role_stability: 0.8, injury_risk: 0.1, schedule_difficulty: -0.15, playoff_schedule: -0.2, sentiment: 0.2, volatility: false },
  { player_id: 'pollard', name: 'Tony Pollard', position: 'RB', team: 'DAL', ros_projection: 160, next_3: 30, usage_trend: -0.1, role_stability: 0.7, injury_risk: 0.2, schedule_difficulty: -0.05, playoff_schedule: -0.1, sentiment: -0.1, volatility: true },
  { player_id: 'mixon', name: 'Joe Mixon', position: 'RB', team: 'HOU', ros_projection: 175, next_3: 33, usage_trend: 0.2, role_stability: 0.9, injury_risk: 0.1, schedule_difficulty: 0.0, playoff_schedule: -0.1, sentiment: 0.2, volatility: false },
  { player_id: 'jacobs', name: 'Josh Jacobs', position: 'RB', team: 'GB', ros_projection: 170, next_3: 32, usage_trend: 0.0, role_stability: 0.8, injury_risk: 0.2, schedule_difficulty: 0.05, playoff_schedule: 0.0, sentiment: 0.0, volatility: false },
  
  // More WRs
  { player_id: 'allen_k', name: 'Keenan Allen', position: 'WR', team: 'CHI', ros_projection: 170, next_3: 32, usage_trend: 0.0, role_stability: 0.9, injury_risk: 0.2, schedule_difficulty: 0.1, playoff_schedule: 0.05, sentiment: 0.0, volatility: false },
  { player_id: 'metcalf', name: 'DK Metcalf', position: 'WR', team: 'SEA', ros_projection: 175, next_3: 33, usage_trend: 0.1, role_stability: 0.9, injury_risk: 0.1, schedule_difficulty: 0.0, playoff_schedule: 0.05, sentiment: 0.1, volatility: false },
  { player_id: 'samuel', name: 'Deebo Samuel', position: 'WR', team: 'SF', ros_projection: 165, next_3: 31, usage_trend: 0.0, role_stability: 0.8, injury_risk: 0.2, schedule_difficulty: -0.2, playoff_schedule: -0.25, sentiment: 0.1, volatility: true },
  { player_id: 'waddle', name: 'Jaylen Waddle', position: 'WR', team: 'MIA', ros_projection: 170, next_3: 32, usage_trend: 0.1, role_stability: 0.9, injury_risk: 0.1, schedule_difficulty: -0.15, playoff_schedule: -0.2, sentiment: 0.2, volatility: false },
  { player_id: 'olave', name: 'Chris Olave', position: 'WR', team: 'NO', ros_projection: 165, next_3: 31, usage_trend: 0.2, role_stability: 0.9, injury_risk: 0.1, schedule_difficulty: 0.05, playoff_schedule: 0.1, sentiment: 0.2, volatility: false },
  { player_id: 'higgins', name: 'Tee Higgins', position: 'WR', team: 'CIN', ros_projection: 160, next_3: 30, usage_trend: 0.1, role_stability: 0.8, injury_risk: 0.2, schedule_difficulty: 0.0, playoff_schedule: 0.0, sentiment: 0.1, volatility: false },
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { week, season } = await req.json().catch(() => ({}));
    
    // Default to current week/season
    const now = new Date();
    const currentWeek = week || Math.min(Math.floor((now.getTime() - new Date(now.getFullYear(), 8, 1).getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1, 18);
    const currentSeason = season || now.getFullYear();

    console.log(`Seeding player valuations for Week ${currentWeek}, ${currentSeason}`);

    // Calculate player values
    const valuations = PLAYER_DATA.map(player => {
      // Base value from ROS projection with some normalization
      const baseValue = player.ros_projection;
      
      // Apply context modifiers
      const usageModifier = 1 + (player.usage_trend * 0.1);
      const roleModifier = player.role_stability;
      const injuryModifier = 1 - (player.injury_risk * 0.15);
      const scheduleModifier = 1 - (player.schedule_difficulty * 0.05);
      const sentimentModifier = 1 + (player.sentiment * 0.03);
      
      const finalValue = baseValue * usageModifier * roleModifier * injuryModifier * scheduleModifier * sentimentModifier;
      
      return {
        player_id: player.player_id,
        player_name: player.name,
        position: player.position,
        team: player.team,
        week: currentWeek,
        season: currentSeason,
        player_value: finalValue,
        ros_projection: player.ros_projection,
        next_3_weeks_projection: player.next_3,
        usage_trend: player.usage_trend,
        role_stability: player.role_stability,
        injury_risk: player.injury_risk,
        schedule_difficulty: player.schedule_difficulty,
        playoff_schedule_difficulty: player.playoff_schedule,
        sentiment_score: player.sentiment,
        confidence_score: player.volatility ? 60 : 75,
        volatility_flag: player.volatility,
        last_updated_at: new Date().toISOString(),
      };
    });

    // Upsert valuations
    const { error } = await supabase
      .from('player_valuations')
      .upsert(valuations, { 
        onConflict: 'player_id,week,season',
        ignoreDuplicates: false 
      });

    if (error) {
      console.error('Error seeding valuations:', error);
      throw error;
    }

    console.log(`Successfully seeded ${valuations.length} player valuations`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        count: valuations.length,
        week: currentWeek,
        season: currentSeason,
        message: `Seeded ${valuations.length} players for Week ${currentWeek}, ${currentSeason}` 
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('Error in seed-player-valuations:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to seed valuations' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
