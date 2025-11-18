import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Reconcile stats from multiple sources
 * 
 * POST /reconcile-stats
 * Body: { week, season, playerIds? }
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { week, season, playerIds } = await req.json();

    if (!week || !season) {
      throw new Error('Week and season are required');
    }

    console.log(`Reconciling stats for Week ${week}, Season ${season}`);

    // Fetch all stat entries for this week
    let query = supabase
      .from('player_stats')
      .select('*')
      .eq('week', week)
      .eq('season', season);

    if (playerIds && playerIds.length > 0) {
      query = query.in('player_id', playerIds);
    }

    const { data: allStats, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch stats: ${fetchError.message}`);
    }

    if (!allStats || allStats.length === 0) {
      return new Response(
        JSON.stringify({
          message: 'No stats found to reconcile',
          week,
          season
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Group by player_id
    const statsByPlayer = new Map<string, any[]>();
    allStats.forEach(stat => {
      if (!statsByPlayer.has(stat.player_id)) {
        statsByPlayer.set(stat.player_id, []);
      }
      statsByPlayer.get(stat.player_id)!.push(stat);
    });

    console.log(`Found stats for ${statsByPlayer.size} players`);

    const reconciled: any[] = [];
    let updatedCount = 0;

    // Reconcile each player
    for (const [playerId, stats] of statsByPlayer.entries()) {
      if (stats.length === 1) {
        // Only one source, just ensure it's marked properly
        const stat = stats[0];
        if (!stat.finalized && stat.source_type === 'actual') {
          await supabase
            .from('player_stats')
            .update({ 
              finalized: true,
              reconciled_version: (stat.reconciled_version || 0) + 1
            })
            .eq('id', stat.id);
          updatedCount++;
        }
        continue;
      }

      // Multiple sources - reconcile using priority rules
      // Priority: actuals > projections, freshest first
      const sortedStats = stats.sort((a, b) => {
        // 1. Actuals > Projections
        const typeScore: Record<string, number> = { actual: 2, derived: 1, projection: 0 };
        const typeCompare = (typeScore[b.source_type as string] || 0) - (typeScore[a.source_type as string] || 0);
        if (typeCompare !== 0) return typeCompare;

        // 2. Higher confidence
        const confCompare = (b.confidence || 0) - (a.confidence || 0);
        if (Math.abs(confCompare) > 0.01) return confCompare;

        // 3. Freshest
        const aTime = new Date(a.freshness_ts || a.updated_at).getTime();
        const bTime = new Date(b.freshness_ts || b.updated_at).getTime();
        return bTime - aTime;
      });

      const primary = sortedStats[0];
      const conflictFlags: string[] = [];

      // Check for conflicts in key stats
      const keyStats = ['passing_yards', 'rushing_yards', 'receiving_yards', 'passing_tds', 'rushing_tds', 'receiving_tds'];
      keyStats.forEach(statKey => {
        const values = sortedStats.map(s => s[statKey]).filter(v => v != null);
        const uniqueValues = [...new Set(values)];
        if (uniqueValues.length > 1) {
          conflictFlags.push(`${statKey}: ${uniqueValues.join(' vs ')}`);
        }
      });

      // Update primary stat with reconciliation metadata
      const allActuals = sortedStats.every(s => s.source_type === 'actual');
      await supabase
        .from('player_stats')
        .update({
          finalized: allActuals,
          conflict_flags: conflictFlags,
          reconciled_version: (primary.reconciled_version || 0) + 1,
          freshness_ts: new Date().toISOString()
        })
        .eq('id', primary.id);

      updatedCount++;

      // Mark other sources as superseded (could delete or mark)
      // For now, just leave them - they provide audit trail
      
      reconciled.push({
        player_id: playerId,
        player_name: primary.player_name,
        sources: sortedStats.length,
        conflicts: conflictFlags.length,
        finalized: allActuals
      });
    }

    console.log(`Reconciliation complete: ${updatedCount} players updated`);

    return new Response(
      JSON.stringify({
        message: 'Reconciliation complete',
        week,
        season,
        players_reconciled: statsByPlayer.size,
        players_updated: updatedCount,
        details: reconciled.slice(0, 100) // Limit response size
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Reconciliation error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to reconcile stats' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
