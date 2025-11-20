import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Starting canonical player mapping...');

    // Normalize player name for matching
    const normalizeName = (name: string): string => {
      if (!name) return '';
      return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/\./g, '')
        .replace(/['']/g, '')
        .replace(/\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i, '')
        .replace(/\s+/g, ' ');
    };

    const normalizeTeam = (team: string | null): string | null => {
      if (!team) return null;
      if (team === 'LAR') return 'LA';
      return team;
    };

    let matched = 0;
    let created = 0;
    let unmatched = 0;

    const BATCH_SIZE = 300; // Smaller batches to reduce memory usage
    const UPSERT_CHUNK = 25;

    // Clean up null teams first
    console.log('Cleaning up players with null teams...');
    await supabase.from('canonical_players').delete().is('team', null);
    
    // Fetch existing canonical players for lookup - in batches
    console.log('Loading existing canonical players...');
    const existingBySleeperIdMap = new Map<string, any>();
    const existingByNflIdMap = new Map<string, any>();
    
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('canonical_players')
        .select('id, player_name, position, team, sleeper_id, nfl_id')
        .range(from, from + BATCH_SIZE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      
      for (const cp of data) {
        if (cp.sleeper_id) existingBySleeperIdMap.set(cp.sleeper_id, cp);
        if (cp.nfl_id) existingByNflIdMap.set(cp.nfl_id, cp);
      }
      
      console.log(`Loaded ${from + data.length} canonical players...`);
      if (data.length < BATCH_SIZE) break;
      from += BATCH_SIZE;
    }

    console.log(`Loaded ${existingBySleeperIdMap.size} existing canonical players`);

    // Build NFL player lookup - in batches
    console.log('Building NFL player lookup...');
    const nflByNamePos = new Map<string, any[]>();
    from = 0;
    while (true) {
      const { data: nflBatch, error } = await supabase
        .from('nfl_fantasy_points')
        .select('player_id, player_name, position, team')
        .gte('season', 2024)
        .not('player_id', 'is', null)
        .not('player_name', 'is', null)
        .range(from, from + BATCH_SIZE - 1);
      
      if (error) throw error;
      if (!nflBatch || nflBatch.length === 0) break;

      for (const player of nflBatch) {
        const normalizedFull = normalizeName(player.player_name);
        const key = `${normalizedFull}:${player.position}`;
        if (!nflByNamePos.has(key)) {
          nflByNamePos.set(key, []);
        }
        nflByNamePos.get(key)!.push(player);
      }

      if (nflBatch.length < BATCH_SIZE) break;
      from += BATCH_SIZE;
    }
    console.log(`Built lookup for ${nflByNamePos.size} NFL player combinations`);

    const matchedNflIds = new Set<string>();

    // Process Sleeper players in batches
    console.log('Processing Sleeper players...');
    from = 0;
    let totalProcessed = 0;
    
    while (true) {
      const { data: sleeperBatch, error } = await supabase
        .from('sleeper_projections')
        .select('player_id, player_name, position, team')
        .eq('season', 2025)
        .not('player_id', 'is', null)
        .not('player_name', 'is', null)
        .range(from, from + BATCH_SIZE - 1);

      if (error) throw error;
      if (!sleeperBatch || sleeperBatch.length === 0) break;

      const toInsert: any[] = [];
      const toUpdate: any[] = [];

      // Process each player in this batch
      for (const sleeperPlayer of sleeperBatch) {
        const normalizedName = normalizeName(sleeperPlayer.player_name);
        const key = `${normalizedName}:${sleeperPlayer.position}`;
        const normalizedSleeperTeam = normalizeTeam(sleeperPlayer.team);

        const existing = existingBySleeperIdMap.get(sleeperPlayer.player_id);

        if (existing) {
          matched++;
          continue;
        }

        // Try to match with NFL player
        let nflCandidates = nflByNamePos.get(key) || [];
        let bestMatch = nflCandidates.length >= 1 ? 
          (nflCandidates.find((nfl: any) => normalizeTeam(nfl.team) === normalizedSleeperTeam) || nflCandidates[0]) : null;

        if (bestMatch) {
          const nflExisting = existingByNflIdMap.get(bestMatch.player_id);
          if (nflExisting) {
            if (!nflExisting.sleeper_id) {
              toUpdate.push({ 
                id: nflExisting.id, 
                sleeper_id: sleeperPlayer.player_id
              });
            }
            matched++;
            matchedNflIds.add(bestMatch.player_id);
          } else {
            const teamValue = normalizeTeam(bestMatch.team) || normalizedSleeperTeam;
            if (teamValue) {
              toInsert.push({
                player_name: sleeperPlayer.player_name,
                position: sleeperPlayer.position,
                team: teamValue,
                sleeper_id: sleeperPlayer.player_id,
                nfl_id: bestMatch.player_id
              });
              matchedNflIds.add(bestMatch.player_id);
              created++;
            }
          }
        } else {
          const normalizedTeam = normalizeTeam(sleeperPlayer.team);
          if (normalizedTeam) {
            toInsert.push({
              player_name: sleeperPlayer.player_name,
              position: sleeperPlayer.position,
              team: normalizedTeam,
              sleeper_id: sleeperPlayer.player_id
            });
            created++;
            unmatched++;
          }
        }
      }

      // Upsert in smaller chunks
      for (let i = 0; i < toInsert.length; i += UPSERT_CHUNK) {
        const chunk = toInsert.slice(i, i + UPSERT_CHUNK);
        await supabase.from('canonical_players').upsert(chunk, { onConflict: 'sleeper_id' });
      }

      // Update existing records
      for (const update of toUpdate) {
        await supabase.from('canonical_players').update({ sleeper_id: update.sleeper_id }).eq('id', update.id);
      }

      totalProcessed += sleeperBatch.length;
      console.log(`Processed ${totalProcessed} Sleeper players (batch: +${toInsert.length} inserted, +${toUpdate.length} updated)`);
      
      if (sleeperBatch.length < BATCH_SIZE) break;
      from += BATCH_SIZE;
    }

    console.log(`✅ Mapping complete: ${matched} matched, ${created} created, ${unmatched} unmatched`);

    return new Response(
      JSON.stringify({
        success: true,
        matched,
        created,
        unmatched,
        message: `Successfully mapped ${matched} existing players, created ${created} new players (${unmatched} without NFL match)`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
