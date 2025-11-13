import { supabase } from "@/integrations/supabase/client";
import { isTeamOnBye } from "./byeWeekSchedule";

export type RosterPlayer = {
  player_id?: string;
  playerId?: string;
  id?: string;
  player_name?: string;
  playerName?: string;
  name?: string;
  position?: string | number;
  team?: string;
  projected?: number;
  // Optional flags to enrich
  is_bye_week?: boolean;
  injury_status?: string | null;
  injury_duration_weeks?: number;
  ros_projection?: number;
  ppg_projection?: number;
  [key: string]: any;
};

/**
 * Enrich a roster array with bye week information and ROS projections from player_rankings.
 */
export async function enrichRosterWithValuations(
  roster: RosterPlayer[] | any,
  opts?: { week?: number; season?: number }
): Promise<RosterPlayer[]> {
  const rosterArray = Array.isArray(roster) ? roster : [];
  if (rosterArray.length === 0) return rosterArray as RosterPlayer[];

  // Extract player IDs
  const playerIds = rosterArray
    .map(p => p.player_id || p.playerId || p.id)
    .filter(Boolean);

  if (playerIds.length === 0) {
    return enrichWithHardcodedByeWeeks(rosterArray);
  }

  // Fetch ROS projections from player_rankings
  const { data: rankings } = await supabase
    .from('player_rankings')
    .select('player_id, avg_projected_ppg_ros, avg_actual_ppg')
    .eq('season', opts?.season || 2025)
    .in('player_id', playerIds);

  const rankingsMap = new Map(
    (rankings || []).map(r => [r.player_id, r])
  );

  // Enrich with bye weeks and ROS data
  return roster.map(player => {
    const playerId = player.player_id || player.playerId || player.id;
    const team = player.team;
    const isByeWeek = team ? isTeamOnBye(team, 1) : false;
    const rankingData = playerId ? rankingsMap.get(playerId) : null;
    
    return {
      ...player,
      is_bye_week: isByeWeek,
      injury_status: player.injury_status || null,
      injury_duration_weeks: player.injury_duration_weeks || 0,
      ros_projection: rankingData?.avg_projected_ppg_ros || 0,
      ppg_projection: rankingData?.avg_actual_ppg || 0,
    };
  });
}

function enrichWithHardcodedByeWeeks(roster: RosterPlayer[]): RosterPlayer[] {
  return roster.map(player => {
    const team = player.team;
    const isByeWeek = team ? isTeamOnBye(team, 1) : false;
    
    return {
      ...player,
      is_bye_week: isByeWeek,
      injury_status: player.injury_status || null,
      injury_duration_weeks: player.injury_duration_weeks || 0,
      ros_projection: 0,
      ppg_projection: 0,
    };
  });
}
