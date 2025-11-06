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
  [key: string]: any;
};

/**
 * Enrich a roster array with bye week information using hardcoded bye weeks.
 */
export async function enrichRosterWithValuations(
  roster: RosterPlayer[] | any,
  opts?: { week?: number; season?: number }
): Promise<RosterPlayer[]> {
  const rosterArray = Array.isArray(roster) ? roster : [];
  if (rosterArray.length === 0) return rosterArray as RosterPlayer[];

  // Use hardcoded bye weeks since player_valuations table was removed
  return enrichWithHardcodedByeWeeks(rosterArray);
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
    };
  });
}
