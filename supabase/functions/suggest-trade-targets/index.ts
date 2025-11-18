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

  // Helper to normalize player names for fuzzy matching
  const normalizeName = (name?: string) => {
    if (!name) return '';
    return name
      .toLowerCase()
      .replace(/\./g, '')
      .replace(/['’]/g, '')
      .replace(/-/g, ' ')
      .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  try {
    const authHeader = req.headers.get('authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader! } },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { leagueId, targetPosition } = await req.json();
    console.log('Suggest trade targets:', { leagueId, targetPosition });

    // Get league info
    const { data: league } = await supabase
      .from('connected_leagues')
      .select('user_team_id')
      .eq('id', leagueId)
      .eq('user_id', user.id)
      .single();

    if (!league) {
      throw new Error('League not found');
    }

    const userTeamId = league.user_team_id;

    // Get positional strengths
    const { data: strengths } = await supabase
      .from('team_positional_strengths')
      .select('*')
      .eq('league_id', leagueId)
      .order('position')
      .order('rank');

    if (!strengths || strengths.length === 0) {
      return new Response(JSON.stringify({ 
        error: 'Positional strength data not available. Please compute team strengths first.',
        suggestions: []
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get user's strengths and weaknesses
    const userStrengths = strengths.filter(s => s.team_id === userTeamId);
    const userStrengthMap = new Map(userStrengths.map(s => [s.position, s]));

    // Identify user's weak positions (unless specific position requested)
    let targetPositions: string[];
    if (targetPosition) {
      targetPositions = [targetPosition.toUpperCase()];
    } else {
      targetPositions = userStrengths
        .filter(s => s.rank >= 6 || s.z_score < -0.3)
        .sort((a, b) => a.z_score - b.z_score)
        .slice(0, 2)
        .map(s => s.position);
    }

    console.log('Target positions to improve:', targetPositions);

    // Get all rosters
    const { data: rosters } = await supabase
      .from('roster_snapshots')
      .select('team_id, player_id, player_name, position')
      .eq('league_id', leagueId);

    if (!rosters || rosters.length === 0) {
      throw new Error('No roster data available');
    }

    // Get player rankings
    const playerIds = [...new Set(rosters.map(r => r.player_id))];
    const { data: rankings } = await supabase
      .from('player_rankings')
      .select('player_id, player_name, position, team, trade_value, avg_projected_ppg_ros')
      .eq('season', 2025)
      .in('player_id', playerIds);

    const rankingsMap = new Map(rankings?.map(r => [r.player_id, r]) || []);

    // Fallback map by name+position from trade_value_weekly to handle ID mismatches
    const { data: tvw } = await supabase
      .from('trade_value_weekly')
      .select('player_name, position, trade_value, meta_proj_ros_ppg')
      .order('trade_value', { ascending: false })
      .limit(2000);

    const tvwMap = new Map<string, { trade_value: number; projected_ppg: number }>();
    const tvwByLast = new Map<string, { trade_value: number; projected_ppg: number }>();
    (tvw || []).forEach(r => {
      const nameNorm = normalizeName(r.player_name);
      const posNorm = (r.position || '').toUpperCase();
      const key = `${nameNorm}|${posNorm}`;
      const last = nameNorm.split(' ').pop() || '';
      const lastKey = `${last}|${posNorm}`;
      const obj = {
        trade_value: Number(r.trade_value) || 0,
        projected_ppg: Number(r.meta_proj_ros_ppg) || 0,
      };
      if (!tvwMap.has(key)) tvwMap.set(key, obj);
      // Keep highest value for last-name map
      const prev = tvwByLast.get(lastKey);
      if (!prev || obj.trade_value > prev.trade_value) tvwByLast.set(lastKey, obj);
    });

    // Organize rosters by team
    const teamRosters = new Map<string, any[]>();
    rosters.forEach(r => {
      if (!teamRosters.has(r.team_id)) {
        teamRosters.set(r.team_id, []);
      }
      const ranking = rankingsMap.get(r.player_id);
      let trade_value = ranking?.trade_value || 0;
      let projected_ppg = ranking?.avg_projected_ppg_ros || 0;
      if (!trade_value || trade_value === 0) {
        const nameNorm = normalizeName(r.player_name);
        const posNorm = (r.position || '').toUpperCase();
        const key = `${nameNorm}|${posNorm}`;
        const lastKey = `${(nameNorm.split(' ').pop() || '')}|${posNorm}`;
        const tv = tvwMap.get(key) || tvwByLast.get(lastKey);
        if (tv) {
          trade_value = tv.trade_value || trade_value;
          projected_ppg = tv.projected_ppg || projected_ppg;
        }
      }
      teamRosters.get(r.team_id)!.push({
        player_id: r.player_id,
        player_name: r.player_name,
        position: r.position,
        trade_value,
        projected_ppg
      });
    });

    const userRoster = teamRosters.get(userTeamId) || [];

    // Find user's strong positions to trade from
    const tradeablePositions = userStrengths
      .filter(s => s.z_score > 0.5 && s.rank <= 4)
      .map(s => s.position);

    console.log('Can trade from strong positions:', tradeablePositions);

    // Generate trade suggestions
    const suggestions: any[] = [];

    // For each target position
    for (const targetPos of targetPositions) {
      const targetPosStrength = userStrengthMap.get(targetPos);
      
      // Find teams strong at this position
      const strongTeams = strengths
        .filter(s => s.position === targetPos && s.rank <= 3 && s.team_id !== userTeamId)
        .map(s => s.team_id);

      // Look at players in this position from strong teams
      for (const teamId of strongTeams.slice(0, 3)) {
        const teamRoster = teamRosters.get(teamId) || [];
        const teamStrengths = strengths.filter(s => s.team_id === teamId);
        const teamStrengthMap = new Map(teamStrengths.map(s => [s.position, s]));

        // Find their top players at target position
        const topPlayers = teamRoster
          .filter(p => p.position === targetPos && p.trade_value > 5)
          .sort((a, b) => b.trade_value - a.trade_value)
          .slice(0, 3);

        for (const target of topPlayers) {
          // Find what we can offer - prioritize trading from our strengths to their weaknesses
          const theirWeakPositions = teamStrengths
            .filter(s => s.rank >= 6 || s.z_score < -0.3)
            .map(s => s.position);

          // Find our players that match their needs
          const offerCandidates = userRoster
            .filter(p => {
              // Must be in a position we're strong at OR they're weak at
              const inOurStrength = tradeablePositions.includes(p.position);
              const inTheirWeakness = theirWeakPositions.includes(p.position);
              const fairValue = p.trade_value >= target.trade_value * 0.8 && 
                               p.trade_value <= target.trade_value * 1.2;
              return (inOurStrength || inTheirWeakness) && fairValue && p.trade_value > 0;
            })
            .sort((a, b) => Math.abs(a.trade_value - target.trade_value) - Math.abs(b.trade_value - target.trade_value))
            .slice(0, 2);

          if (offerCandidates.length > 0) {
            const offer = offerCandidates[0];
            const theirPosStrength = teamStrengthMap.get(offer.position);
            
            suggestions.push({
              target_player: {
                name: target.player_name,
                position: target.position,
                trade_value: Math.round(target.trade_value * 10) / 10,
                projected_ppg: Math.round(target.projected_ppg * 10) / 10
              },
              offer_player: {
                name: offer.player_name,
                position: offer.position,
                trade_value: Math.round(offer.trade_value * 10) / 10,
                projected_ppg: Math.round(offer.projected_ppg * 10) / 10
              },
              target_team_id: teamId,
              your_position_rank: targetPosStrength?.rank || 0,
              your_position_z_score: targetPosStrength ? Math.round(targetPosStrength.z_score * 100) / 100 : 0,
              their_position_rank: theirPosStrength?.rank || 0,
              their_position_z_score: theirPosStrength ? Math.round(theirPosStrength.z_score * 100) / 100 : 0,
              value_difference: Math.round((target.trade_value - offer.trade_value) * 10) / 10,
              strategic_fit: {
                improves_your_weakness: targetPosStrength ? targetPosStrength.rank >= 6 : false,
                addresses_their_weakness: theirPosStrength ? theirPosStrength.rank >= 6 : false,
                trading_from_your_strength: tradeablePositions.includes(offer.position)
              },
              rationale: `Trade ${offer.player_name} (your #${userStrengthMap.get(offer.position)?.rank} ${offer.position}) for ${target.player_name} to improve your #${targetPosStrength?.rank} ${targetPos} position. They are #${theirPosStrength?.rank} at ${offer.position}.`
            });
          }
        }
      }
    }

    // If nothing found with strict criteria, apply a relaxed fallback to avoid empty results
    if (suggestions.length === 0) {
      console.log('No suggestions from strict criteria, applying relaxed fallback targeting top players');
      // Fallback A: use players from teamRosters with non-zero trade values
      const candidateTargetsA: any[] = [];
      for (const [teamId, roster] of teamRosters.entries()) {
        if (teamId === userTeamId) continue;
        for (const p of roster) {
          if (targetPositions.includes(p.position) && (p.trade_value || 0) > 10) {
            candidateTargetsA.push({ ...p, teamId });
          }
        }
      }
      candidateTargetsA.sort((a, b) => b.trade_value - a.trade_value);
      const topTargetsA = candidateTargetsA.slice(0, 8);
      for (const target of topTargetsA) {
        const offer = userRoster
          .filter(p => (p.trade_value || 0) > 0)
          .sort((a, b) => Math.abs((a.trade_value || 0) - target.trade_value) - Math.abs((b.trade_value || 0) - target.trade_value))[0];
        if (offer) {
          const targetPosStrength = userStrengthMap.get(target.position);
          const teamStrengths = strengths.filter(s => s.team_id === target.teamId);
          const theirPosStrength = teamStrengths.find(s => s.position === offer.position);
          suggestions.push({
            target_player: {
              name: target.player_name,
              position: target.position,
              trade_value: Math.round((target.trade_value || 0) * 10) / 10,
              projected_ppg: Math.round((target.projected_ppg || 0) * 10) / 10
            },
            offer_player: {
              name: offer.player_name,
              position: offer.position,
              trade_value: Math.round((offer.trade_value || 0) * 10) / 10,
              projected_ppg: Math.round((offer.projected_ppg || 0) * 10) / 10
            },
            target_team_id: target.teamId,
            your_position_rank: targetPosStrength?.rank || 0,
            your_position_z_score: targetPosStrength ? Math.round(targetPosStrength.z_score * 100) / 100 : 0,
            their_position_rank: theirPosStrength?.rank || 0,
            their_position_z_score: theirPosStrength ? Math.round(theirPosStrength.z_score * 100) / 100 : 0,
            value_difference: Math.round(((target.trade_value || 0) - (offer.trade_value || 0)) * 10) / 10,
            strategic_fit: {
              improves_your_weakness: targetPosStrength ? targetPosStrength.rank >= 6 : false,
              addresses_their_weakness: theirPosStrength ? theirPosStrength.rank >= 6 : false,
              trading_from_your_strength: tradeablePositions.includes(offer.position)
            },
            rationale: `Fallback A: Trade ${offer.player_name} for ${target.player_name} to improve ${target.position}.`
          });
        }
      }

      // Fallback B: if still empty, build targets from trade_value_weekly and map to league rosters by name+position
      if (suggestions.length === 0) {
        console.log('Fallback A produced no results, applying Fallback B from trade_value_weekly');
        const namePosToTeam = new Map<string, string>();
        for (const [teamId, roster] of teamRosters.entries()) {
          for (const p of roster) {
            const key = `${normalizeName(p.player_name)}|${(p.position || '').toUpperCase()}`;
            if (!namePosToTeam.has(key)) namePosToTeam.set(key, teamId);
          }
        }
        const topTvw = (tvw || [])
          .filter(r => targetPositions.includes((r.position || '').toUpperCase()))
          .sort((a, b) => Number(b.trade_value) - Number(a.trade_value))
          .slice(0, 100);
        for (const r of topTvw) {
          const key = `${normalizeName(r.player_name)}|${(r.position || '').toUpperCase()}`;
          const teamId = namePosToTeam.get(key);
          if (!teamId || teamId === userTeamId) continue;
          const trade_value = Number(r.trade_value) || 0;
          const projected_ppg = Number(r.meta_proj_ros_ppg) || 0;
          if (trade_value <= 10) continue;
          const offer = userRoster
            .filter(p => (p.trade_value || 0) > 0)
            .sort((a, b) => Math.abs((a.trade_value || 0) - trade_value) - Math.abs((b.trade_value || 0) - trade_value))[0];
          if (!offer) continue;
          const targetPosStrength = userStrengthMap.get(r.position || '');
          const teamStrengths = strengths.filter(s => s.team_id === teamId);
          const theirPosStrength = teamStrengths.find(s => s.position === offer.position);
          suggestions.push({
            target_player: {
              name: r.player_name,
              position: r.position,
              trade_value: Math.round(trade_value * 10) / 10,
              projected_ppg: Math.round(projected_ppg * 10) / 10
            },
            offer_player: {
              name: offer.player_name,
              position: offer.position,
              trade_value: Math.round((offer.trade_value || 0) * 10) / 10,
              projected_ppg: Math.round((offer.projected_ppg || 0) * 10) / 10
            },
            target_team_id: teamId,
            your_position_rank: targetPosStrength?.rank || 0,
            your_position_z_score: targetPosStrength ? Math.round(targetPosStrength.z_score * 100) / 100 : 0,
            their_position_rank: theirPosStrength?.rank || 0,
            their_position_z_score: theirPosStrength ? Math.round(theirPosStrength.z_score * 100) / 100 : 0,
            value_difference: Math.round((trade_value - (offer.trade_value || 0)) * 10) / 10,
            strategic_fit: {
              improves_your_weakness: targetPosStrength ? targetPosStrength.rank >= 6 : false,
              addresses_their_weakness: theirPosStrength ? theirPosStrength.rank >= 6 : false,
              trading_from_your_strength: tradeablePositions.includes(offer.position)
            },
            rationale: `Fallback B: Trade ${offer.player_name} for ${r.player_name} to improve ${r.position}.`
          });
          if (suggestions.length >= 10) break;
        }
      }
    }

    // Final sort by strategic fit and value fairness
    suggestions.sort((a, b) => {
      // Prioritize improving weaknesses
      if (a.strategic_fit.improves_your_weakness && !b.strategic_fit.improves_your_weakness) return -1;
      if (!a.strategic_fit.improves_your_weakness && b.strategic_fit.improves_your_weakness) return 1;
      
      // Then by addressing their weakness
      if (a.strategic_fit.addresses_their_weakness && !b.strategic_fit.addresses_their_weakness) return -1;
      if (!a.strategic_fit.addresses_their_weakness && b.strategic_fit.addresses_their_weakness) return 1;
      
      // Then by value fairness
      return Math.abs(a.value_difference) - Math.abs(b.value_difference);
    });

    return new Response(
      JSON.stringify({ 
        suggestions: suggestions.slice(0, 10),
        target_positions: targetPositions,
        user_team_id: userTeamId
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in suggest-trade-targets:', error);
    return new Response(
      JSON.stringify({ error: error.message, suggestions: [] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
