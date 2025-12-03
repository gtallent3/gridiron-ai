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

  // Helper to normalize player names for fuzzy matching
  const normalizeName = (name?: string) => {
    if (!name) return '';
    return name
      .toLowerCase()
      .replace(/\./g, '')
      .replace(/['']/g, '')
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
    // NEVER include K or DST in trade suggestions
    let targetPositions: string[];
    if (targetPosition) {
      const pos = targetPosition.toUpperCase();
      if (pos === 'K' || pos === 'DST' || pos === 'DEF' || pos === 'D/ST') {
        return new Response(JSON.stringify({ 
          error: 'Trade suggestions are not available for kickers and defenses',
          suggestions: []
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      targetPositions = [pos];
    } else {
      // For general queries, target all skill positions, prioritizing weak positions
      const skillPositions = ['QB', 'RB', 'WR', 'TE'];
      const weakPositions = userStrengths
        .filter(s => skillPositions.includes(s.position) && (s.rank >= 6 || s.z_score < -0.3))
        .sort((a, b) => a.z_score - b.z_score)
        .slice(0, 2)
        .map(s => s.position);
      
      // If no weak positions found, include all skill positions
      targetPositions = weakPositions.length > 0 ? weakPositions : skillPositions;
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

    // Get ALL player rankings (not just league players) to use as value reference
    const { data: allRankings } = await supabase
      .from('player_rankings')
      .select('player_id, player_name, position, team, trade_value, avg_projected_ppg_ros')
      .eq('season', 2025)
      .gt('trade_value', 0)
      .order('trade_value', { ascending: false })
      .limit(500);

    // Create maps for both ID and name-based lookups
    const rankingsById = new Map((allRankings || []).map(r => [r.player_id, r]));
    const rankingsByName = new Map<string, any>();
    (allRankings || []).forEach(r => {
      const key = `${normalizeName(r.player_name)}|${r.position}`;
      if (!rankingsByName.has(key)) {
        rankingsByName.set(key, r);
      }
    });

    console.log(`Loaded ${allRankings?.length || 0} player rankings`);

    // Organize rosters by team with trade values
    const teamRosters = new Map<string, any[]>();
    rosters.forEach(r => {
      if (!teamRosters.has(r.team_id)) {
        teamRosters.set(r.team_id, []);
      }
      
      // Try ID lookup first, then name lookup
      let ranking = rankingsById.get(r.player_id);
      if (!ranking) {
        const nameKey = `${normalizeName(r.player_name)}|${(r.position || '').toUpperCase()}`;
        ranking = rankingsByName.get(nameKey);
      }
      
      teamRosters.get(r.team_id)!.push({
        player_id: r.player_id,
        player_name: r.player_name,
        position: r.position,
        trade_value: ranking?.trade_value || 0,
        projected_ppg: ranking?.avg_projected_ppg_ros || 0
      });
    });

    const userRoster = teamRosters.get(userTeamId) || [];
    console.log(`User roster has ${userRoster.length} players`);

    // Find user's strong positions to trade from
    const tradeablePositions = userStrengths
      .filter(s => s.z_score > 0.3 && s.rank <= 5)
      .map(s => s.position);

    console.log('Can trade from strong positions:', tradeablePositions);

    // Generate trade suggestions
    const suggestions: any[] = [];

    // For each target position
    for (const targetPos of targetPositions) {
      const targetPosStrength = userStrengthMap.get(targetPos);
      
      // Find teams strong at this position
      const strongTeams = strengths
        .filter(s => s.position === targetPos && s.rank <= 4 && s.team_id !== userTeamId)
        .map(s => s.team_id);

      // Look at players in this position from strong teams
      for (const teamId of strongTeams.slice(0, 4)) {
        const teamRoster = teamRosters.get(teamId) || [];
        const teamStrengths = strengths.filter(s => s.team_id === teamId);
        const teamStrengthMap = new Map(teamStrengths.map(s => [s.position, s]));

        // Find their top players at target position (exclude K and DST)
        const topPlayers = teamRoster
          .filter(p => p.position === targetPos && p.trade_value > 3)
          .filter(p => p.position !== 'K' && p.position !== 'DST' && p.position !== 'DEF' && p.position !== 'D/ST')
          .sort((a, b) => b.trade_value - a.trade_value)
          .slice(0, 3);

        for (const target of topPlayers) {
          // Find what we can offer - prioritize trading from our strengths to their weaknesses
          const theirWeakPositions = teamStrengths
            .filter(s => s.rank >= 6 || s.z_score < -0.3)
            .map(s => s.position);

          // Find our players that match their needs (exclude K and DST)
          const offerCandidates = userRoster
            .filter(p => {
              // Never offer K or DST
              if (p.position === 'K' || p.position === 'DST' || p.position === 'DEF' || p.position === 'D/ST') return false;
              // Must have some trade value
              if (p.trade_value <= 0) return false;
              // Check if fair value (within 50% range)
              const fairValue = p.trade_value >= target.trade_value * 0.5 && 
                               p.trade_value <= target.trade_value * 1.5;
              // Prefer positions we're strong at or they're weak at
              const inOurStrength = tradeablePositions.includes(p.position);
              const inTheirWeakness = theirWeakPositions.includes(p.position);
              return fairValue && (inOurStrength || inTheirWeakness);
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
              rationale: `Trade ${offer.player_name} (your #${userStrengthMap.get(offer.position)?.rank || '?'} ${offer.position}) for ${target.player_name} to improve your #${targetPosStrength?.rank || '?'} ${targetPos} position.`
            });
          }
        }
      }
    }

    // Fallback: if no strict suggestions, relax criteria
    if (suggestions.length === 0) {
      console.log('No suggestions from strict criteria, applying relaxed fallback');
      
      // Find any valuable players on other teams at target positions
      for (const [teamId, roster] of teamRosters.entries()) {
        if (teamId === userTeamId) continue;
        
        for (const player of roster) {
          if (!targetPositions.includes(player.position)) continue;
          if (player.position === 'K' || player.position === 'DST') continue;
          if (player.trade_value <= 3) continue;
          
          // Find any reasonable offer from user's roster
          const offer = userRoster
            .filter(p => p.trade_value > 0)
            .filter(p => p.position !== 'K' && p.position !== 'DST')
            .filter(p => Math.abs(p.trade_value - player.trade_value) <= Math.max(player.trade_value * 0.6, 10))
            .sort((a, b) => Math.abs(a.trade_value - player.trade_value) - Math.abs(b.trade_value - player.trade_value))[0];
          
          if (offer) {
            const targetPosStrength = userStrengthMap.get(player.position);
            const teamStrengths = strengths.filter(s => s.team_id === teamId);
            const theirPosStrength = teamStrengths.find(s => s.position === offer.position);
            
            suggestions.push({
              target_player: {
                name: player.player_name,
                position: player.position,
                trade_value: Math.round(player.trade_value * 10) / 10,
                projected_ppg: Math.round(player.projected_ppg * 10) / 10
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
              value_difference: Math.round((player.trade_value - offer.trade_value) * 10) / 10,
              strategic_fit: {
                improves_your_weakness: targetPosStrength ? targetPosStrength.rank >= 6 : false,
                addresses_their_weakness: theirPosStrength ? theirPosStrength.rank >= 6 : false,
                trading_from_your_strength: tradeablePositions.includes(offer.position)
              },
              rationale: `Trade ${offer.player_name} for ${player.player_name} to improve your ${player.position} depth.`
            });
          }
          
          if (suggestions.length >= 10) break;
        }
        if (suggestions.length >= 10) break;
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

    console.log(`Returning ${suggestions.length} trade suggestions`);

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
