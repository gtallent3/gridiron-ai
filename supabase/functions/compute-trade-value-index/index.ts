import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting Trade Value Index computation...');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch all player rankings
    const { data: rankings, error: fetchError } = await supabase
      .from('player_rankings')
      .select('*')
      .order('avg_projected_ppg_ros', { ascending: false });

    if (fetchError) {
      console.error('Error fetching player rankings:', fetchError);
      throw fetchError;
    }

    if (!rankings || rankings.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No player rankings found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing ${rankings.length} players...`);

    // Helper to normalize SoS 1-32 → -1..+1
    const normSoS = (rank: number | null): number => {
      if (rank && rank >= 1 && rank <= 32) {
        return (rank - 16.5) / 15.5;
      }
      return 0;
    };

    // Find current week
    const currentWeek = rankings.reduce(
      (max, r) => Math.max(max, Number(r.current_week ?? 0)),
      0
    );

    console.log(`Current week: ${currentWeek}`);

    const rows: Array<{
      player_id: string;
      player_name: string;
      position: string;
      team: string;
      raw_value: number;
    }> = [];

    // Calculate raw trade values for each player
    for (const p of rankings) {
      const {
        player_id,
        player_name,
        position,
        team,
        avg_projected_ppg_ros,
        avg_actual_ppg,
        ros_sos_rank,
        playoff_sos_rank,
        bye_week,
      } = p;

      if (!player_name || !position) continue;

      // Position-specific configuration
      let wProj = 0.5;
      let wActual = 0.5;
      let sosMult = 0.1;
      let sosPlayoffMult = 0.1;
      let scarcity = 1.0;

      if (position === 'QB') {
        wProj = 0.5;
        wActual = 0.5;
        sosMult = 0.15;
        sosPlayoffMult = 0.25;
        scarcity = 1.15;
      } else if (position === 'RB') {
        wProj = 0.3;
        wActual = 0.7;
        sosMult = 0.10;
        sosPlayoffMult = 0.17;
        scarcity = 1.10;
      } else if (position === 'WR') {
        wProj = 0.4;
        wActual = 0.6;
        sosMult = 0.12;
        sosPlayoffMult = 0.20;
        scarcity = 1.05;
      } else if (position === 'TE') {
        wProj = 0.6;
        wActual = 0.4;
        sosMult = 0.05;
        sosPlayoffMult = 0.08;
        scarcity = 1.20;
      } else {
        continue; // Skip unknown positions
      }

      // 1. Baseline (weighted average of projected and actual PPG)
      const baseline =
        (avg_projected_ppg_ros ?? 0) * wProj + (avg_actual_ppg ?? 0) * wActual;

      // 2. Strength of Schedule adjustment
      const sosAdj =
        (1 + normSoS(ros_sos_rank) * sosMult) *
        (1 + normSoS(playoff_sos_rank) * sosPlayoffMult);

      // 3. Bye week adjustment
      let byeAdj = 1.0;
      if (bye_week) {
        if (bye_week < currentWeek) {
          byeAdj = 1.05; // Bye already happened - slight boost
        } else if (bye_week >= currentWeek) {
          byeAdj = 0.9; // Bye still ahead - slight penalty
        }
      }

      // 4. Floor for low PPG players
      const R = avg_projected_ppg_ros < 8 ? 0.25 : 1.0;

      // 5. Combine all factors
      const raw = baseline * sosAdj * byeAdj * R * scarcity;

      rows.push({
        player_id,
        player_name,
        position,
        team,
        raw_value: Number(raw.toFixed(4)),
      });
    }

    console.log(`Calculated raw values for ${rows.length} players`);

    // Group by position
    const byPos: Record<string, typeof rows> = rows.reduce((acc, r) => {
      (acc[r.position] ||= []).push(r);
      return acc;
    }, {} as Record<string, typeof rows>);

    const updates: Array<{ player_id: string; trade_value: number }> = [];

    // Normalize and scale by position
    for (const [pos, list] of Object.entries(byPos)) {
      const vals = list.map((r) => r.raw_value);
      const minV = Math.min(...vals);
      const maxV = Math.max(...vals);
      const range = Math.max(1e-6, maxV - minV);

      // Normalize to 0-1
      for (const r of list) {
        (r as any).norm = (r.raw_value - minV) / range;
      }

      // Position-specific max values
      const posMax = ['QB', 'TE'].includes(pos) ? 50 : 100;
      const topN = ['QB', 'TE'].includes(pos) ? 20 : 30;
      const targetAvg = pos === 'QB' || pos === 'TE' ? 20 : pos === 'RB' ? 25 : 30;

      // Scale to 1-posMax
      for (const r of list) {
        (r as any).trade_value = 1 + (r as any).norm * (posMax - 1);
      }

      // Calibrate top N to target average
      const sorted = [...list].sort((a, b) => (b as any).trade_value - (a as any).trade_value);
      const top = sorted.slice(0, Math.min(topN, sorted.length));
      const currentAvg =
        top.reduce((a, b) => a + (b as any).trade_value, 0) / Math.max(top.length, 1);
      const factor = currentAvg > 0 ? targetAvg / currentAvg : 1;

      // Apply calibration factor and clamp to valid range
      for (const r of list) {
        let tv = (r as any).trade_value * factor;
        tv = Math.max(1, Math.min(tv, posMax));
        
        updates.push({
          player_id: r.player_id,
          trade_value: Number(tv.toFixed(2)),
        });
      }
    }

    console.log(`Updating ${updates.length} player trade values...`);

    // Update trade values in batches
    const batchSize = 100;
    let updated = 0;
    
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      
      for (const update of batch) {
        const { error: updateError } = await supabase
          .from('player_rankings')
          .update({ trade_value: update.trade_value })
          .eq('player_id', update.player_id);

        if (updateError) {
          console.error(`Error updating ${update.player_id}:`, updateError);
        } else {
          updated++;
        }
      }
      
      console.log(`Updated ${Math.min(i + batchSize, updates.length)} / ${updates.length} players`);
    }

    console.log(`Successfully updated ${updated} player trade values`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Trade values computed and updated for ${updated} players`,
        playersProcessed: updated,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in compute-trade-value-index:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
