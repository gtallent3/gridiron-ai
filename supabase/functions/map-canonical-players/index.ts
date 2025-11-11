import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
        .normalize('NFD') // strip diacritics
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/\./g, '')
        .replace(/[’']/g, '') // remove different apostrophe types
        .replace(/\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i, '')
        .replace(/\s+/g, ' ');
    };

    // Normalize team abbreviation
    const normalizeTeam = (team: string | null): string | null => {
      if (!team) return null;
      if (team === 'LAR') return 'LA';
      return team;
    };

    // Pagination helpers to fetch all rows beyond default 1000 limit
    const PAGE_SIZE = 1000;
    const fetchAllSleeper = async () => {
      const results: any[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from('sleeper_projections')
          .select('player_id, player_name, position, team')
          .eq('season', 2025)
          .not('player_id', 'is', null)
          .not('player_name', 'is', null)
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        results.push(...data);
        if (data.length < PAGE_SIZE) break;
      }
      return results;
    };

    const fetchAllNFL = async () => {
      const results: any[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from('nfl_fantasy_points')
          .select('player_id, player_name, position, team')
          .gte('season', 2024)
          .not('player_id', 'is', null)
          .not('player_name', 'is', null)
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        results.push(...data);
        if (data.length < PAGE_SIZE) break;
      }
      return results;
    };

    const sleeperPlayers = await fetchAllSleeper();
    const nflPlayers = await fetchAllNFL();

    console.log(`Found ${sleeperPlayers?.length || 0} Sleeper players, ${nflPlayers?.length || 0} NFL players`);

    // Create maps for deduplication
    const sleeperMap = new Map<string, any>();
    for (const player of sleeperPlayers || []) {
      if (!sleeperMap.has(player.player_id)) {
        sleeperMap.set(player.player_id, player);
      }
    }

    const nflMap = new Map<string, any>();
    for (const player of nflPlayers || []) {
      if (!nflMap.has(player.player_id)) {
        nflMap.set(player.player_id, player);
      }
    }

    // Build normalized name lookup for NFL players (with fuzzy matching support)
    const nflByNamePos = new Map<string, any[]>();
    const nflByLastName = new Map<string, any[]>();
    
    for (const player of nflMap.values()) {
      const normalizedFull = normalizeName(player.player_name);
      const key = `${normalizedFull}:${player.position}`;
      
      if (!nflByNamePos.has(key)) {
        nflByNamePos.set(key, []);
      }
      nflByNamePos.get(key)!.push(player);
      
      // Also index by last name for fallback matching
      const lastName = normalizedFull.split(' ').pop();
      if (lastName) {
        if (!nflByLastName.has(lastName)) {
          nflByLastName.set(lastName, []);
        }
        nflByLastName.get(lastName)!.push(player);
      }
    }

    // Fetch all existing canonical players to avoid individual lookups (paginate beyond 1000 default)
    const fetchAllCanonical = async () => {
      const results: any[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from('canonical_players')
          .select('id, sleeper_id, nfl_id')
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        results.push(...data);
        if (data.length < PAGE_SIZE) break;
      }
      return results;
    };

    // Clean up existing players with null teams before fetching
    console.log('Cleaning up players with null teams...');
    const { error: cleanupError } = await supabase
      .from('canonical_players')
      .delete()
      .is('team', null);
    
    if (cleanupError) {
      console.error('Error cleaning up null teams:', cleanupError);
    } else {
      console.log('Cleaned up existing players with null teams');
    }

    const existingCanonical = await fetchAllCanonical();

    const existingBySleeperIdMap = new Map<string, any>();
    const existingByNflIdMap = new Map<string, any>();
    
    for (const cp of existingCanonical || []) {
      if (cp.sleeper_id) existingBySleeperIdMap.set(cp.sleeper_id, cp);
      if (cp.nfl_id) existingByNflIdMap.set(cp.nfl_id, cp);
    }

    let matched = 0;
    let created = 0;
    let unmatched = 0;
    
    const toInsert: any[] = [];
    const toUpdate: any[] = [];
    const unmatchedRecords: any[] = [];
    const matchedNflIds = new Set<string>(); // Track NFL IDs that have been matched

    // Process Sleeper players in memory first
    for (const sleeperPlayer of sleeperMap.values()) {
      const normalizedName = normalizeName(sleeperPlayer.player_name);
      const key = `${normalizedName}:${sleeperPlayer.position}`;
      const normalizedSleeperTeam = normalizeTeam(sleeperPlayer.team);

      // Check if already exists by sleeper_id
      const existing = existingBySleeperIdMap.get(sleeperPlayer.player_id);

      if (existing) {
        // If exists but missing nfl_id, try to match and update
        if (!existing.nfl_id) {
          // Try to find NFL match (same logic as below)
          const normalizedName = normalizeName(sleeperPlayer.player_name);
          const key = `${normalizedName}:${sleeperPlayer.position}`;
          const normalizedSleeperTeam = normalizeTeam(sleeperPlayer.team);
          
          let nflCandidates = nflByNamePos.get(key) || [];
          if (nflCandidates.length === 0) {
            for (const [nflKey, candidates] of nflByNamePos.entries()) {
              if (nflKey.startsWith(normalizedName + ':')) {
                nflCandidates = candidates;
                break;
              }
            }
          }
          
          let bestMatch = null as any;
          if (nflCandidates.length === 1) {
            bestMatch = nflCandidates[0];
          } else if (nflCandidates.length > 1) {
            const teamMatch = nflCandidates.find(
              (nfl: any) => normalizeTeam(nfl.team) === normalizedSleeperTeam
            );
            bestMatch = teamMatch || nflCandidates[0];
          }
          
          if (bestMatch && !existingByNflIdMap.has(bestMatch.player_id)) {
            const teamValue = normalizedSleeperTeam || bestMatch.team;
            if (teamValue) { // Only update if team is not null
              toUpdate.push({
                id: existing.id,
                nfl_id: bestMatch.player_id,
                team: teamValue
              });
              matchedNflIds.add(bestMatch.player_id);
            }
          }
        }
        matched++;
        continue;
      }

      // Try to match with NFL player - multiple strategies
      let nflCandidates = nflByNamePos.get(key) || [];
      
      // Strategy 1: If no exact match, try without position constraint
      if (nflCandidates.length === 0) {
        for (const [nflKey, candidates] of nflByNamePos.entries()) {
          if (nflKey.startsWith(normalizedName + ':')) {
            nflCandidates = candidates;
            break;
          }
        }
      }

      // Strategy 2: If still no match, try last name + team + position
      if (nflCandidates.length === 0 && normalizedSleeperTeam) {
        const lastName = normalizedName.split(' ').pop();
        if (lastName) {
          const lastNameMatches = nflByLastName.get(lastName) || [];
          nflCandidates = lastNameMatches.filter(
            (p: any) => p.position === sleeperPlayer.position && normalizeTeam(p.team) === normalizedSleeperTeam
          );
        }
      }

      // Strategy 3: If still no match, try just last name + position (no team requirement)
      if (nflCandidates.length === 0) {
        const lastName = normalizedName.split(' ').pop();
        if (lastName) {
          const lastNameMatches = nflByLastName.get(lastName) || [];
          nflCandidates = lastNameMatches.filter((p: any) => p.position === sleeperPlayer.position);
        }
      }
      
      let bestMatch = null as any;
      if (nflCandidates.length === 1) {
        bestMatch = nflCandidates[0];
      } else if (nflCandidates.length > 1) {
        // Multiple matches - prefer team match, then most similar name
        const teamMatch = nflCandidates.find(
          (nfl: any) => normalizeTeam(nfl.team) === normalizedSleeperTeam
        );
        bestMatch = teamMatch || nflCandidates[0];
      }

      if (bestMatch) {
        // Check if NFL player already mapped
        const nflExisting = existingByNflIdMap.get(bestMatch.player_id);

        if (nflExisting) {
          // Update with sleeper_id if missing
          if (!nflExisting.sleeper_id) {
            toUpdate.push({
              id: nflExisting.id,
              sleeper_id: sleeperPlayer.player_id,
              team: normalizedSleeperTeam || bestMatch.team
            });
            matched++;
          }
          matchedNflIds.add(bestMatch.player_id);
        } else {
        // Create new canonical player with both IDs
          const teamValue = normalizedSleeperTeam || bestMatch.team;
          if (teamValue) { // Only insert if team is not null
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
        // No match - create with only sleeper_id
        const normalizedTeam = normalizeTeam(sleeperPlayer.team);
        
        if (normalizedTeam) { // Only insert if team is not null
          toInsert.push({
            player_name: sleeperPlayer.player_name,
            position: sleeperPlayer.position,
            team: normalizedTeam,
            sleeper_id: sleeperPlayer.player_id
          });
          
          unmatchedRecords.push({
            player_name: sleeperPlayer.player_name,
            position: sleeperPlayer.position,
            team: normalizedTeam,
            source: 'sleeper',
            source_player_id: sleeperPlayer.player_id,
            possible_matches: JSON.stringify(nflCandidates)
          });
          created++;
          unmatched++;
        }
      }
    }

    // Process NFL players that weren't matched
    for (const nflPlayer of nflMap.values()) {
      const existing = existingByNflIdMap.get(nflPlayer.player_id);

      // Skip if already matched to a Sleeper player or already exists
      if (!existing && !matchedNflIds.has(nflPlayer.player_id)) {
        const normalizedTeam = normalizeTeam(nflPlayer.team);
        
        if (normalizedTeam) { // Only insert if team is not null
          toInsert.push({
            player_name: nflPlayer.player_name,
            position: nflPlayer.position,
            team: normalizedTeam,
            nfl_id: nflPlayer.player_id
          });
          
          unmatchedRecords.push({
            player_name: nflPlayer.player_name,
            position: nflPlayer.position,
            team: normalizedTeam,
            source: 'nfl',
            source_player_id: nflPlayer.player_id
          });
          created++;
          unmatched++;
        }
      }
    }

    // Batch upsert new records (split by id presence to avoid unique conflicts)
    const CHUNK_SIZE = 100;
    for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
      const chunk = toInsert.slice(i, i + CHUNK_SIZE);
      const sleeperOnly = chunk.filter((r: any) => r.sleeper_id && !r.nfl_id);
      const nflOnly = chunk.filter((r: any) => r.nfl_id && !r.sleeper_id);
      const bothIds = chunk.filter((r: any) => r.sleeper_id && r.nfl_id);

      if (sleeperOnly.length) {
        const { error } = await supabase
          .from('canonical_players')
          .upsert(sleeperOnly, { onConflict: 'sleeper_id' });
        if (error) {
          console.error(`Upsert(sleeper_id) error for chunk ${i}-${i + sleeperOnly.length}:`, error);
        }
      }

      if (nflOnly.length) {
        const { error } = await supabase
          .from('canonical_players')
          .upsert(nflOnly, { onConflict: 'nfl_id' });
        if (error) {
          console.error(`Upsert(nfl_id) error for chunk ${i}-${i + nflOnly.length}:`, error);
        }
      }

      if (bothIds.length) {
        const { error } = await supabase
          .from('canonical_players')
          .upsert(bothIds, { onConflict: 'nfl_id' });
        if (error) {
          console.error(`Upsert(both on nfl_id) error for chunk ${i}-${i + bothIds.length}:`, error);
        }
      }
    }

    // Batch update existing records
    for (const update of toUpdate) {
      const updateData: any = { team: update.team };
      if (update.sleeper_id) updateData.sleeper_id = update.sleeper_id;
      if (update.nfl_id) updateData.nfl_id = update.nfl_id;
      
      await supabase
        .from('canonical_players')
        .update(updateData)
        .eq('id', update.id);
    }

    // Batch insert unmatched records
    for (let i = 0; i < unmatchedRecords.length; i += CHUNK_SIZE) {
      const chunk = unmatchedRecords.slice(i, i + CHUNK_SIZE);
      await supabase
        .from('unmatched_players')
        .upsert(chunk, { onConflict: 'source,source_player_id' });
    }

    console.log(`Mapping complete: ${matched} matched, ${created} created, ${unmatched} unmatched`);

    return new Response(
      JSON.stringify({
        success: true,
        matched,
        created,
        unmatched,
        message: 'Canonical player mapping completed'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error mapping canonical players:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
