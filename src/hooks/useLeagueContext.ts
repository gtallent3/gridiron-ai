import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

export interface LeagueContext {
  leagueId: string | null;
  leagueName: string | null;
  platform: string | null;
  teamId: string | null;
  teamName: string | null;
  currentWeek: number | null;
  scoringType: string | null;
  isLoading: boolean;
}

export function useLeagueContext() {
  const { leagueId: routeLeagueId } = useParams<{ leagueId: string }>();
  const [context, setContext] = useState<LeagueContext>({
    leagueId: null,
    leagueName: null,
    platform: null,
    teamId: null,
    teamName: null,
    currentWeek: null,
    scoringType: null,
    isLoading: true,
  });

  useEffect(() => {
    if (routeLeagueId) {
      fetchLeagueContext(routeLeagueId);
    } else {
      setContext(prev => ({ ...prev, isLoading: false }));
    }
  }, [routeLeagueId]);

  const fetchLeagueContext = async (leagueId: string) => {
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session?.user) return;

      // Fetch league details
      const { data: league, error: leagueError } = await supabase
        .from('connected_leagues')
        .select('*')
        .eq('id', leagueId)
        .eq('user_id', session.session.user.id)
        .single();

      if (leagueError) throw leagueError;

      // Fetch user's team
      const { data: team, error: teamError } = await supabase
        .from('user_teams')
        .select('*')
        .eq('league_id', leagueId)
        .eq('team_id', league.user_team_id)
        .single();

      if (teamError) console.error('Team fetch error:', teamError);

      setContext({
        leagueId: league.id,
        leagueName: league.league_name,
        platform: league.platform,
        teamId: league.user_team_id,
        teamName: team?.team_name || null,
        currentWeek: league.current_week,
        scoringType: league.scoring_type,
        isLoading: false,
      });
    } catch (error) {
      console.error('Error fetching league context:', error);
      setContext(prev => ({ ...prev, isLoading: false }));
    }
  };

  const refreshContext = () => {
    if (routeLeagueId) {
      fetchLeagueContext(routeLeagueId);
    }
  };

  return { context, refreshContext };
}
