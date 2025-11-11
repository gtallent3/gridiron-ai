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

    // Fetch distinct players from sleeper_projections
    const { data: sleeperPlayers, error: sleeperError } = await supabase
      .from('sleeper_projections')
      .select('player_id, player_name, position, team')
      .not('player_id', 'is', null)
      .not('player_name', 'is', null);

    if (sleeperError) throw sleeperError;

    // Fetch distinct players from nfl_fantasy_points
    const { data: nflPlayers, error: nflError } = await supabase
      .from('nfl_fantasy_points')
      .select('player_id, player_name, position, team')
      .not('player_id', 'is', null)
      .not('player_name', 'is', null);

    if (nflError) throw nflError;

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

    // Fetch all existing canonical players to avoid individual lookups
    const { data: existingCanonical } = await supabase
      .from('canonical_players')
      .select('id, sleeper_id, nfl_id');

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

    // Process Sleeper players in memory first
    for (const sleeperPlayer of sleeperMap.values()) {
      const normalizedName = normalizeName(sleeperPlayer.player_name);
      const key = `${normalizedName}:${sleeperPlayer.position}`;
      const normalizedSleeperTeam = normalizeTeam(sleeperPlayer.team);

      // Check if already exists by sleeper_id
      const existing = existingBySleeperIdMap.get(sleeperPlayer.player_id);

      if (existing) {
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
        } else {
          // Create new canonical player with both IDs
          toInsert.push({
            player_name: sleeperPlayer.player_name,
            position: sleeperPlayer.position,
            team: normalizedSleeperTeam || bestMatch.team,
            sleeper_id: sleeperPlayer.player_id,
            nfl_id: bestMatch.player_id
          });
          created++;
        }
      } else {
        // No match - create with only sleeper_id
        toInsert.push({
          player_name: sleeperPlayer.player_name,
          position: sleeperPlayer.position,
          team: normalizedSleeperTeam,
          sleeper_id: sleeperPlayer.player_id
        });
        
        unmatchedRecords.push({
          player_name: sleeperPlayer.player_name,
          position: sleeperPlayer.position,
          team: normalizedSleeperTeam,
          source: 'sleeper',
          source_player_id: sleeperPlayer.player_id,
          possible_matches: JSON.stringify(nflCandidates)
        });
        created++;
        unmatched++;
      }
    }

    // Process NFL players that weren't matched
    for (const nflPlayer of nflMap.values()) {
      const existing = existingByNflIdMap.get(nflPlayer.player_id);

      if (!existing) {
        const normalizedTeam = normalizeTeam(nflPlayer.team);
        
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

    // Batch insert new records (in chunks to avoid payload limits)
    const CHUNK_SIZE = 100;
    for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
      const chunk = toInsert.slice(i, i + CHUNK_SIZE);
      const { error } = await supabase
        .from('canonical_players')
        .insert(chunk);
      
      if (error) {
        console.error(`Insert error for chunk ${i}-${i + chunk.length}:`, error);
      }
    }

    // Batch update existing records
    for (const update of toUpdate) {
      await supabase
        .from('canonical_players')
        .update({ sleeper_id: update.sleeper_id, team: update.team })
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
