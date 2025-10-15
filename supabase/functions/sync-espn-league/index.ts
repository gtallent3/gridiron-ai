import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization');
    console.log('Auth header present:', !!authHeader);
    
    if (!authHeader) {
      console.error('No authorization header found in request');
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    console.log('Token format check:', token.substring(0, 10) + '...' + token.substring(token.length - 10));
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      console.error('Auth error details:', {
        hasError: !!authError,
        errorName: authError?.name,
        errorMessage: authError?.message,
        errorStatus: authError?.status,
        hasUser: !!user
      });
      throw new Error('Unauthorized');
    }

    console.log('Auth successful for user:', user.id);

    const { espn_s2, swid, leagueId } = await req.json();

    if (!espn_s2 || !swid || !leagueId) {
      throw new Error('Missing required ESPN credentials: espn_s2, SWID, and leagueId are required');
    }

    console.log(`Fetching ESPN league ${leagueId} for user ${user.id}`);

    // Get current NFL season
    const now = new Date();
    const currentYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;

    // Fetch league data from ESPN API (include mMembers for owner details)
    const leagueUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${currentYear}/segments/0/leagues/${leagueId}?view=mSettings&view=mTeam&view=mRoster&view=mMembers`;
    
    console.log('Fetching ESPN league data...');
    const leagueResponse = await fetch(leagueUrl, {
      headers: {
        'Cookie': `espn_s2=${espn_s2}; SWID=${swid}`,
      },
    });

    if (!leagueResponse.ok) {
      console.error('ESPN API error:', leagueResponse.status);
      if (leagueResponse.status === 401) {
        throw new Error('Invalid ESPN cookies. Please check your espn_s2 and SWID values.');
      }
      throw new Error(`Failed to fetch ESPN league data: ${leagueResponse.status}`);
    }

    const leagueData = await leagueResponse.json();
    console.log(`League found: ${leagueData.settings.name}`);

    // Determine scoring type
    let scoringType = 'standard';
    if (leagueData.settings?.scoringSettings?.scoringItems) {
      const pprScore = leagueData.settings.scoringSettings.scoringItems['53']; // 53 is reception points
      if (pprScore > 0) {
        scoringType = pprScore === 1 ? 'ppr' : pprScore === 0.5 ? 'half_ppr' : 'custom';
      }
    }

    // Normalize IDs for robust matching (remove braces, hyphens, lowercase)
    const normalizeId = (id: string): string => {
      return (id || '').trim().toLowerCase().replace(/[{}\-]/g, '');
    };

    const normalizedSwid = normalizeId(swid);
    console.log('Normalized SWID for matching:', normalizedSwid.substring(0, 8) + '...');

    // Find the user's team with robust owner matching
    const userTeam = leagueData.teams?.find((team: any) => {
      const owners = (team.owners || []).map(normalizeId);
      const primaryOwner = normalizeId(team.primaryOwner || '');
      
      // Check if SWID matches any owner or the primary owner
      const isMatch = owners.includes(normalizedSwid) || (primaryOwner && primaryOwner === normalizedSwid);
      
      if (isMatch) {
        console.log(`Found user team: ${team.name || team.location + ' ' + team.nickname} (ID: ${team.id})`);
      }
      
      return isMatch;
    });

    if (!userTeam) {
      // Log team owner details for debugging (without exposing full IDs)
      console.log('Could not find matching team. League teams summary:');
      leagueData.teams?.slice(0, 3).forEach((team: any, idx: number) => {
        console.log(`  Team ${idx + 1}: ${team.name || team.location + ' ' + team.nickname}, owners count: ${team.owners?.length || 0}, primaryOwner exists: ${!!team.primaryOwner}`);
      });
      
      throw new Error('Could not find your team in this league. Make sure the SWID cookie belongs to an account that is a member of this league.');
    }

    console.log(`Found user team: ${userTeam.name || userTeam.location + ' ' + userTeam.nickname}`);

    // Upsert league data
    const { data: leagueRecord, error: leagueError } = await supabase
      .from('connected_leagues')
      .upsert({
        user_id: user.id,
        platform: 'espn',
        league_id: leagueId,
        league_name: leagueData.settings.name,
        league_size: leagueData.settings.size,
        scoring_type: scoringType,
        scoring_settings: leagueData.settings.scoringSettings,
        last_synced_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,platform,league_id',
      })
      .select()
      .single();

    if (leagueError) {
      console.error('League insert error:', leagueError);
      throw leagueError;
    }

    console.log('League data stored successfully');

    // Get roster for the user's team
    const roster = userTeam.roster?.entries?.map((entry: any) => ({
      player_id: entry.playerId?.toString(),
      player_name: entry.playerPoolEntry?.player?.fullName,
      position: entry.playerPoolEntry?.player?.defaultPositionId,
      slot: entry.lineupSlotId,
    })) || [];

    // Upsert team data
    const { error: teamError } = await supabase
      .from('user_teams')
      .upsert({
        league_id: leagueRecord.id,
        team_id: userTeam.id.toString(),
        team_name: userTeam.name || `${userTeam.location} ${userTeam.nickname}`,
        roster: roster,
      }, {
        onConflict: 'league_id,team_id',
      });

    if (teamError) {
      console.error('Team insert error:', teamError);
      throw teamError;
    }

    console.log('Team data stored successfully');

    return new Response(
      JSON.stringify({
        message: `Successfully synced ESPN league: ${leagueData.settings.name}`,
        league: {
          name: leagueData.settings.name,
          id: leagueId,
          platform: 'espn',
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error in sync-espn-league:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
