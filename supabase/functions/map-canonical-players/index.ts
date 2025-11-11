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

    // Only map fantasy-relevant positions to reduce noise and false positives
    const includedPositions = new Set(['QB', 'RB', 'WR', 'TE', 'K']);

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
      if (!includedPositions.has(player.position)) continue;
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

    // Build normalized name lookup for NFL players
    const nflByNamePos = new Map<string, any[]>();
    for (const player of nflMap.values()) {
      const key = `${normalizeName(player.player_name)}:${player.position}`;
      if (!nflByNamePos.has(key)) {
        nflByNamePos.set(key, []);
      }
      nflByNamePos.get(key)!.push(player);
    }

    let matched = 0;
    let created = 0;
    let unmatched = 0;

    // Process Sleeper players
    for (const sleeperPlayer of sleeperMap.values()) {
      const normalizedName = normalizeName(sleeperPlayer.player_name);
      const key = `${normalizedName}:${sleeperPlayer.position}`;
      const normalizedSleeperTeam = normalizeTeam(sleeperPlayer.team);

      // Check if already exists by sleeper_id
      const { data: existing } = await supabase
        .from('canonical_players')
        .select('id')
        .eq('sleeper_id', sleeperPlayer.player_id)
        .single();

      if (existing) {
        matched++;
        continue;
      }

      // Try to match with NFL player
      let nflCandidates = nflByNamePos.get(key) || [];
      
      // If no exact match, try without position (for players who changed positions)
      if (nflCandidates.length === 0) {
        for (const [nflKey, candidates] of nflByNamePos.entries()) {
          if (nflKey.startsWith(normalizedName + ':')) {
            nflCandidates = candidates;
            console.log(`Position mismatch for ${sleeperPlayer.player_name}: Sleeper=${sleeperPlayer.position}, NFL=${candidates[0]?.position}`);
            break;
          }
        }
      }

      // If still no match, try last-name + team fallback
      if (nflCandidates.length === 0) {
        const lastName = normalizedName.split(' ').pop();
        if (lastName) {
          const lnCandidates: any[] = [];
          for (const p of nflMap.values()) {
            const pLast = normalizeName(p.player_name).split(' ').pop();
            if (pLast === lastName && (!normalizedSleeperTeam || normalizeTeam(p.team) === normalizedSleeperTeam)) {
              lnCandidates.push(p);
            }
          }
          if (lnCandidates.length > 0) {
            nflCandidates = lnCandidates;
            console.log(`Last-name+team fallback used for ${sleeperPlayer.player_name}: candidates=${lnCandidates.length}`);
          }
        }
      }
      
      let bestMatch = null as any;
      if (nflCandidates.length === 1) {
        bestMatch = nflCandidates[0];
      } else if (nflCandidates.length > 1) {
        // Multiple matches - prefer team match
        const teamMatch = nflCandidates.find(
          (nfl: any) => normalizeTeam(nfl.team) === normalizedSleeperTeam
        );
        bestMatch = teamMatch || nflCandidates[0];
        
        if (!teamMatch) {
          console.log(`Multiple NFL matches for ${sleeperPlayer.player_name}, no team match. Sleeper team: ${normalizedSleeperTeam}, NFL teams: ${nflCandidates.map((c: any) => c.team).join(', ')}`);
        }
      } else {
        console.log(`No NFL match found for Sleeper player: ${sleeperPlayer.player_name} (${sleeperPlayer.position}, ${normalizedSleeperTeam})`);
      }

      if (bestMatch) {
        // Check if NFL player already mapped
        const { data: nflExisting } = await supabase
          .from('canonical_players')
          .select('id, sleeper_id')
          .eq('nfl_id', bestMatch.player_id)
          .single();

        if (nflExisting) {
          // Update with sleeper_id if missing
          if (!nflExisting.sleeper_id) {
            await supabase
              .from('canonical_players')
              .update({ 
                sleeper_id: sleeperPlayer.player_id,
                team: normalizedSleeperTeam || bestMatch.team 
              })
              .eq('id', nflExisting.id);
            matched++;
          }
        } else {
          // Create new canonical player with both IDs
          const { error: insertError } = await supabase
            .from('canonical_players')
            .insert({
              player_name: sleeperPlayer.player_name,
              position: sleeperPlayer.position,
              team: normalizedSleeperTeam || bestMatch.team,
              sleeper_id: sleeperPlayer.player_id,
              nfl_id: bestMatch.player_id
            });

          if (!insertError) {
            created++;
          } else {
            console.error('Insert error:', insertError);
          }
        }
      } else {
        // No match - create with only sleeper_id
        const { error: insertError } = await supabase
          .from('canonical_players')
          .insert({
            player_name: sleeperPlayer.player_name,
            position: sleeperPlayer.position,
            team: normalizedSleeperTeam,
            sleeper_id: sleeperPlayer.player_id
          });

        if (!insertError) {
          created++;
          
          // Log as unmatched for manual review
          await supabase
            .from('unmatched_players')
            .insert({
              player_name: sleeperPlayer.player_name,
              position: sleeperPlayer.position,
              team: normalizedSleeperTeam,
              source: 'sleeper',
              source_player_id: sleeperPlayer.player_id,
              possible_matches: JSON.stringify(nflCandidates)
            });
          unmatched++;
        }
      }
    }

    // Process NFL players that weren't matched
    for (const nflPlayer of nflMap.values()) {
      const { data: existing } = await supabase
        .from('canonical_players')
        .select('id')
        .eq('nfl_id', nflPlayer.player_id)
        .single();

      if (!existing) {
        const normalizedTeam = normalizeTeam(nflPlayer.team);
        
        const { error: insertError } = await supabase
          .from('canonical_players')
          .insert({
            player_name: nflPlayer.player_name,
            position: nflPlayer.position,
            team: normalizedTeam,
            nfl_id: nflPlayer.player_id
          });

        if (!insertError) {
          created++;
          
          // Log as unmatched
          await supabase
            .from('unmatched_players')
            .insert({
              player_name: nflPlayer.player_name,
              position: nflPlayer.position,
              team: normalizedTeam,
              source: 'nfl',
              source_player_id: nflPlayer.player_id
            });
          unmatched++;
        }
      }
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
