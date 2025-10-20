import { supabase } from "@/integrations/supabase/client";

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
 * Enrich a roster array with injury and bye week information from player_valuations.
 * Matches by player_name to bridge ESPN vs Sleeper ID differences.
 */
export async function enrichRosterWithValuations(
  roster: RosterPlayer[] | any,
  opts?: { week?: number; season?: number }
): Promise<RosterPlayer[]> {
  const rosterArray = Array.isArray(roster) ? roster : [];
  if (rosterArray.length === 0) return rosterArray as RosterPlayer[];

  // Determine defaults dynamically if not provided
  const now = new Date();
  const seasonYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  const season = opts?.season ?? seasonYear;

  let week = opts?.week;
  
  // If week not specified, find the latest week with data in player_valuations
  if (!week) {
    const { data: latestWeek } = await supabase
      .from('player_valuations')
      .select('week')
      .eq('season', season)
      .order('week', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    week = latestWeek?.week ?? 1;
    console.log(`[enrichRoster] Using latest available week: ${week} for season ${season}`);
  }

  // Collect names present in roster
  const names = rosterArray
    .map((p: RosterPlayer) => p.player_name || p.playerName || p.name)
    .filter(Boolean) as string[];

  if (names.length === 0) return rosterArray as RosterPlayer[];

  // Fetch valuations for those names
  const { data: valuations } = await supabase
    .from('player_valuations')
    .select('player_name, is_bye_week, injury_status, injury_duration_weeks, ros_projection, ppg_projection, next_3_weeks_projection')
    .eq('week', week)
    .eq('season', season)
    .in('player_name', Array.from(new Set(names)));

  console.log(`[enrichRoster] Fetched ${valuations?.length || 0} valuations for ${names.length} names`);
  if (valuations && valuations.length > 0) {
    console.log('[enrichRoster] Sample valuations:', valuations.slice(0, 3).map(v => ({ name: v.player_name, ros: v.ros_projection, ppg: v.ppg_projection })));
  }

  const valMap = new Map<string, any>((valuations || []).map(v => [v.player_name, v]));

  return rosterArray.map((p: RosterPlayer) => {
    const key = (p.player_name || p.playerName || p.name) as string | undefined;
    const v = key ? valMap.get(key) : undefined;
    
    // Debug: Log what data we have for key players
    if (key && (key.includes('Mahomes') || key.includes('Hurts'))) {
      console.log(`[enrichRoster] ${key}:`, {
        key_used: key,
        has_valuation: !!v,
        espn_ros: p.ros_projection,
        espn_ppg: p.ppg_projection,
        val_ros: v?.ros_projection,
        val_ppg: v?.ppg_projection,
      });
    }
    
    return {
      ...p,
      // Prefer player_valuations (authoritative) over ESPN roster data
      ros_projection: v?.ros_projection ?? p.ros_projection ?? 0,
      ppg_projection: v?.ppg_projection ?? p.ppg_projection ?? 0,
      next_3_weeks_projection: v?.next_3_weeks_projection ?? p.next_3_weeks_projection ?? 0,
      // Always use valuations for flags (most up-to-date)
      is_bye_week: v?.is_bye_week ?? p.is_bye_week ?? false,
      injury_status: v?.injury_status ?? p.injury_status ?? null,
      injury_duration_weeks: v?.injury_duration_weeks ?? p.injury_duration_weeks ?? 0,
    };
  });
}
