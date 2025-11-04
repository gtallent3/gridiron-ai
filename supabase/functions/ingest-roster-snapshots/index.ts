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

    const { leagueId } = await req.json();

    if (!leagueId) {
      throw new Error('League ID is required');
    }

    // Get league info
    const { data: league, error: leagueError } = await supabase
      .from('connected_leagues')
      .select('*')
      .eq('id', leagueId)
      .single();

    if (leagueError) throw leagueError;

    // Get ESPN credentials
    const { data: credentials } = await supabase
      .from('espn_credentials')
      .select('*')
      .eq('user_id', league.user_id)
      .eq('league_id', league.league_id)
      .single();

    if (!credentials) {
      throw new Error('ESPN credentials not found');
    }

    // Fetch current rosters from ESPN
    const espnUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2024/segments/0/leagues/${league.league_id}?view=mRoster`;
    
    const espnResponse = await fetch(espnUrl, {
      headers: {
        'Cookie': `swid=${credentials.swid_encrypted}; espn_s2=${credentials.espn_s2_encrypted}`,
      },
    });

    if (!espnResponse.ok) {
      throw new Error(`ESPN API error: ${espnResponse.statusText}`);
    }

    const espnData = await espnResponse.json();
    const teams = espnData.teams || [];

    console.log(`Found ${teams.length} teams for league ${leagueId}`);

    const snapshotDate = new Date().toISOString();
    const rosterSnapshots: any[] = [];

    // Process each team's roster
    for (const team of teams) {
      const roster = team.roster?.entries || [];
      
      for (const entry of roster) {
        const player = entry.playerPoolEntry?.player;
        if (!player) continue;

        // Log player data structure for debugging
        console.log('Player data sample:', JSON.stringify({
          id: player.id,
          fullName: player.fullName,
          firstName: player.firstName,
          lastName: player.lastName,
          defaultPositionId: player.defaultPositionId,
          proTeamId: player.proTeamId,
          draftYear: player.draftYear,
          draftRound: player.draftRound,
          birthDate: player.birthDate,
        }));

        const lineupSlot = entry.lineupSlotId;
        const isStarter = lineupSlot < 20; // ESPN uses IDs < 20 for starting positions
        
        // Determine roster status based on lineup slot
        let rosterStatus = 'active';
        if (lineupSlot === 21) rosterStatus = 'ir';
        else if (lineupSlot === 20) rosterStatus = 'bench';
        else if (isStarter) rosterStatus = 'starter';
        
        // Calculate age from birth date if available
        let age = null;
        if (player.birthDate) {
          const birthYear = player.birthDate.year;
          const birthMonth = player.birthDate.month;
          const birthDay = player.birthDate.day;
          if (birthYear) {
            const birthDate = new Date(birthYear, (birthMonth || 1) - 1, birthDay || 1);
            const today = new Date();
            age = today.getFullYear() - birthDate.getFullYear();
            const monthDiff = today.getMonth() - birthDate.getMonth();
            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
              age--;
            }
          }
        }

        // Build player name from firstName/lastName if fullName not available
        const playerName = player.fullName || 
                          (player.firstName && player.lastName 
                            ? `${player.firstName} ${player.lastName}` 
                            : 'Unknown Player');

        rosterSnapshots.push({
          league_id: leagueId,
          team_id: team.id.toString(),
          player_id: player.id.toString(),
          player_name: playerName,
          snapshot_date: snapshotDate,
          position: player.defaultPositionId ? getPositionName(player.defaultPositionId) : 'UNKNOWN',
          is_starter: isStarter,
          roster_status: rosterStatus,
          age: age,
          draft_year: player.draftYear || null,
          draft_round: player.draftRound || null,
          team: player.proTeamId ? getTeamAbbr(player.proTeamId) : null,
        });
      }
    }

    console.log(`Processing ${rosterSnapshots.length} roster entries`);
    
    // Log a sample of what we're about to insert
    if (rosterSnapshots.length > 0) {
      console.log('Sample roster entry to insert:', JSON.stringify(rosterSnapshots[0], null, 2));
    }

    // Batch insert roster snapshots
    if (rosterSnapshots.length > 0) {
      const { data: insertData, error: insertError } = await supabase
        .from('roster_snapshots')
        .insert(rosterSnapshots)
        .select();

      if (insertError) {
        console.error('Error inserting roster snapshots:', insertError);
        console.error('Failed batch sample:', JSON.stringify(rosterSnapshots.slice(0, 2), null, 2));
        throw insertError;
      }
      
      console.log(`Successfully inserted ${insertData?.length || 0} roster entries`);
    }

    // Update fetch metadata
    await supabase
      .from('fetch_metadata')
      .upsert({
        league_id: leagueId,
        endpoint_type: 'rosters',
        last_fetched_at: snapshotDate,
        fetch_count: 1,
        error_count: 0,
        last_error: null,
      }, {
        onConflict: 'league_id,endpoint_type',
      });

    return new Response(
      JSON.stringify({
        success: true,
        rosterEntriesProcessed: rosterSnapshots.length,
        teamsProcessed: teams.length,
        snapshotDate,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error in ingest-roster-snapshots:', error);

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Helper function to map ESPN position IDs to position names
function getPositionName(positionId: number): string {
  const positions: Record<number, string> = {
    1: 'QB',
    2: 'RB',
    3: 'WR',
    4: 'TE',
    5: 'K',
    16: 'D/ST',
  };
  return positions[positionId] || 'FLEX';
}

// Helper function to map ESPN team IDs to abbreviations
function getTeamAbbr(teamId: number): string {
  const teams: Record<number, string> = {
    1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN',
    8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR',
    15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ',
    21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA',
    27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
  };
  return teams[teamId] || 'FA';
}
