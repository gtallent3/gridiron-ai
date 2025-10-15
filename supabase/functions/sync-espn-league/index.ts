import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ESPN Pro Team ID to abbreviation mapping
const getTeamAbbreviation = (teamId: number): string => {
  const teams: Record<number, string> = {
    1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET',
    9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN',
    17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC',
    25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU'
  };
  return teams[teamId] || 'FA';
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

    // Store credentials securely in Vault
    const { error: storeError } = await supabase.rpc('store_league_credentials', {
      p_user_id: user.id,
      p_platform: 'espn',
      p_league_id: leagueId,
      p_credentials: { espn_s2, swid }
    });

    if (storeError) {
      console.error('Failed to store credentials in Vault:', storeError);
      throw new Error('Unable to securely store credentials');
    }

    // Get current NFL season
    const now = new Date();
    const currentYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;

    // Fetch league data from ESPN API with projections
    const leagueUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${currentYear}/segments/0/leagues/${leagueId}?view=mSettings&view=mTeam&view=mRoster&view=mMembers&view=kona_player_info`;
    
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

    // Get current week and matchup data
    const currentWeek = leagueData.scoringPeriodId || 1;
    const currentMatchupPeriod = leagueData.currentMatchupPeriod || currentWeek;

    // Fetch schedule data for matchups
    const scheduleUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${currentYear}/segments/0/leagues/${leagueId}?view=mMatchup&view=mMatchupScore`;
    const scheduleResponse = await fetch(scheduleUrl, {
      headers: {
        'Cookie': `espn_s2=${espn_s2}; SWID=${swid}`,
      },
    });

    let matchupData: any = {};
    if (scheduleResponse.ok) {
      const scheduleData = await scheduleResponse.json();
      // Find current week matchup for user's team
      const currentMatchup = scheduleData.schedule?.find((m: any) => 
        m.matchupPeriodId === currentMatchupPeriod && 
        (m.home?.teamId === userTeam.id || m.away?.teamId === userTeam.id)
      );
      
      if (currentMatchup) {
        const isHome = currentMatchup.home?.teamId === userTeam.id;
        const opponentTeamId = isHome ? currentMatchup.away?.teamId : currentMatchup.home?.teamId;
        
        matchupData = {
          current_week: currentMatchupPeriod,
          opponent_team_id: opponentTeamId?.toString(),
        };
      }
    }

    // Upsert league data with user's team_id and matchup info
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
        user_team_id: userTeam.id.toString(),
        last_synced_at: new Date().toISOString(),
        ...matchupData,
      }, {
        onConflict: 'user_id,platform,league_id',
      })
      .select()
      .single();

    if (leagueError) {
      throw new Error('Unable to save league data');
    }

      // Sync ALL teams in the league (not just the user's team)
      for (const team of leagueData.teams || []) {
        const roster = (team.roster?.entries || []).map((entry: any) => {
          const player = entry.playerPoolEntry?.player;
          
          // Get current week projection (kona)
          let projected = 0;
          if (player?.stats) {
            const projectionStat = player.stats.find((stat: any) => 
              stat.statSourceId === 1 && stat.scoringPeriodId === leagueData.scoringPeriodId
            );
            projected = projectionStat?.appliedTotal || 0;
          }

          return {
            player_id: entry.playerId?.toString(),
            player_name: player?.fullName,
            position: player?.defaultPositionId,
            team: player?.proTeamId ? getTeamAbbreviation(player.proTeamId) : null,
            projected,
            slot: entry.lineupSlotId,
          };
        });

        // Calculate total projected points for starters only (specific starting slots)
        // ESPN starting slots: 0=QB, 2=RB, 4=RB, 6=WR, 16=DEF, 17=K, 23=FLEX
        const STARTER_SLOTS = [0, 2, 4, 6, 16, 17, 23];
        const totalProjected = roster
          .filter((p: any) => STARTER_SLOTS.includes(p.slot))
          .reduce((sum: number, p: any) => sum + (p.projected || 0), 0);

        // Get team record
        const record = team.record?.overall || { wins: 0, losses: 0, ties: 0 };

      await supabase
        .from('user_teams')
        .upsert({
          league_id: leagueRecord.id,
          team_id: team.id.toString(),
          team_name: team.name || `${team.location} ${team.nickname}`,
          roster: roster,
          wins: record.wins || 0,
          losses: record.losses || 0,
          ties: record.ties || 0,
          total_projected: totalProjected,
        }, {
          onConflict: 'league_id,team_id',
        });
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
    // Sanitize error logs - never log credentials
    const sanitizedMessage = error.message?.replace(/espn_s2=[^;]+/g, 'espn_s2=***').replace(/SWID=[^;]+/g, 'SWID=***');
    console.error('League sync error:', sanitizedMessage || 'Unknown error');
    
    // Return generic error messages without internal details
    let userMessage = 'Unable to sync your league. Please try again.';
    
    if (error.message?.includes('authenticate') || error.message?.includes('credentials') || error.message?.includes('store credentials')) {
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
