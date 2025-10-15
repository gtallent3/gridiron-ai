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
    
    if (!authHeader) {
      console.error('Missing authorization header');
      throw new Error('Authentication required');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    const { espn_s2, swid, leagueId } = await req.json();

    if (!espn_s2 || !swid || !leagueId) {
      throw new Error('Missing required credentials');
    }

    // Get current NFL season
    const now = new Date();
    const currentYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;

    // Fetch league data from ESPN API
    const leagueUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${currentYear}/segments/0/leagues/${leagueId}?view=mSettings&view=mTeam&view=mRoster&view=mMembers`;
    
    const leagueResponse = await fetch(leagueUrl, {
      headers: {
        'Cookie': `espn_s2=${espn_s2}; SWID=${swid}`,
      },
    });

    if (!leagueResponse.ok) {
      if (leagueResponse.status === 401) {
        throw new Error('Unable to authenticate with the provided credentials');
      }
      throw new Error('Unable to fetch league data');
    }

    const leagueData = await leagueResponse.json();

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

    // Find the user's team with robust owner matching
    const userTeam = leagueData.teams?.find((team: any) => {
      const owners = (team.owners || []).map(normalizeId);
      const primaryOwner = normalizeId(team.primaryOwner || '');
      
      return owners.includes(normalizedSwid) || (primaryOwner && primaryOwner === normalizedSwid);
    });

    if (!userTeam) {
      throw new Error('Unable to find your team in this league');
    }

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
      throw new Error('Unable to save league data');
    }

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
      throw new Error('Unable to save team data');
    }

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
    console.error('League sync error:', error.message || 'Unknown error');
    
    // Return generic error messages without internal details
    let userMessage = 'Unable to sync your league. Please try again.';
    
    if (error.message?.includes('authenticate') || error.message?.includes('credentials')) {
      userMessage = 'Unable to authenticate. Please verify your credentials and try again.';
    } else if (error.message?.includes('team')) {
      userMessage = 'Unable to find your team. Please verify you are a member of this league.';
    } else if (error.message?.includes('Database') || error.message?.includes('save')) {
      userMessage = 'Unable to save league data. Please try again.';
    }
    
    return new Response(
      JSON.stringify({ error: userMessage }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
