import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";
import { getCorsHeaders } from "../_shared/cors.ts";


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get cursor parameters for resumable processing
    const { startIndex = 0, batchLimit = 1000 } = await req.json().catch(() => ({}));

    console.log(`Starting canonical player mapping from index ${startIndex}...`);

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

    // Only do expensive setup on first batch to avoid timeouts on resumed batches
    let existingBySleeperIdMap = new Map<string, any>();
    let existingByNflIdMap = new Map<string, any>();
    let nflByNamePos = new Map<string, any[]>();
    
    if (startIndex === 0) {
      // Clean up null teams first (only on first run)
      console.log('Cleaning up players with null teams...');
      await supabase.from('canonical_players').delete().is('team', null);
      
      // Fetch existing canonical players for lookup - in batches
      console.log('Loading existing canonical players...');
      
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
      from = 0;
      while (true) {
        const { data: nflBatch, error } = await supabase
          .from('actual_weekly_points')
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
    } else {
      console.log(`Skipping expensive setup for resumed batch at index ${startIndex}`);
    }

    const matchedNflIds = new Set<string>();

    // Process Sleeper players in batches with cursor-based resumption
    console.log('Processing Sleeper players...');
    let from = startIndex;
    let totalProcessed = 0;
    const maxToProcess = batchLimit;
    
    while (totalProcessed < maxToProcess) {
      const { data: sleeperBatch, error } = await supabase
        .from('sleeper_projections')
        .select('player_id, player_name, position, team')
        .eq('season', 2025)
        .not('player_id', 'is', null)
        .not('player_name', 'is', null)
        .not('team', 'is', null)
        .in('position', ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'])
        .range(from, from + BATCH_SIZE - 1);

      if (error) throw error;
      if (!sleeperBatch || sleeperBatch.length === 0) break;

      const toInsert: any[] = [];
      const toUpdate: any[] = [];

      // Process each player in this batch
      for (const sleeperPlayer of sleeperBatch) {
        // On resumed batches (startIndex > 0), skip expensive matching since data is already loaded
        // Just try to insert new players and let database constraints handle duplicates
        if (startIndex > 0) {
          const normalizedTeam = normalizeTeam(sleeperPlayer.team);
          if (normalizedTeam && sleeperPlayer.position) {
            toInsert.push({
              player_name: sleeperPlayer.player_name,
              position: sleeperPlayer.position,
              team: normalizedTeam,
              sleeper_id: sleeperPlayer.player_id
            });
          }
          continue;
        }
        
        // Full matching logic only on first batch (startIndex === 0)
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
        // On resumed batches, ignore conflicts since we're not doing full matching
        if (startIndex > 0) {
          await supabase.from('canonical_players').upsert(chunk, { 
            onConflict: 'sleeper_id',
            ignoreDuplicates: true 
          });
        } else {
          await supabase.from('canonical_players').upsert(chunk, { onConflict: 'sleeper_id' });
        }
      }

      // Update existing records
      for (const update of toUpdate) {
        await supabase.from('canonical_players').update({ sleeper_id: update.sleeper_id }).eq('id', update.id);
      }

      totalProcessed += sleeperBatch.length;
      console.log(`Processed ${from + sleeperBatch.length} Sleeper players total (batch: +${toInsert.length} inserted, +${toUpdate.length} updated)`);
      
      if (sleeperBatch.length < BATCH_SIZE) {
        // No more data to process
        return new Response(
          JSON.stringify({
            success: true,
            matched,
            created,
            unmatched,
            hasMore: false,
            nextIndex: null,
            message: `✅ Mapping complete: ${matched} matched, ${created} created, ${unmatched} unmatched`
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      from += BATCH_SIZE;
      
      if (totalProcessed >= maxToProcess) {
        // More data to process, return cursor for resumption
        return new Response(
          JSON.stringify({
            success: true,
            matched,
            created,
            unmatched,
            hasMore: true,
            nextIndex: from,
            processedSoFar: from,
            message: `Processed ${from} players so far. Call again with startIndex: ${from} to continue.`
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log(`✅ Mapping complete: ${matched} matched, ${created} created, ${unmatched} unmatched`);

    return new Response(
      JSON.stringify({
        success: true,
        matched,
        created,
        unmatched,
        hasMore: false,
        nextIndex: null,
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
