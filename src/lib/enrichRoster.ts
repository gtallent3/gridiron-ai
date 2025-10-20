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

  const week = opts?.week ?? 7;
  const season = opts?.season ?? 2025;

  // Collect names present in roster
  const names = rosterArray
    .map((p: RosterPlayer) => p.player_name || p.playerName || p.name)
    .filter(Boolean) as string[];

  if (names.length === 0) return rosterArray as RosterPlayer[];

  // Fetch valuations for those names
  const { data: valuations } = await supabase
    .from('player_valuations')
    .select('player_name, is_bye_week, injury_status, injury_duration_weeks')
    .eq('week', week)
    .eq('season', season)
    .in('player_name', Array.from(new Set(names)));

  const valMap = new Map<string, any>((valuations || []).map(v => [v.player_name, v]));

  return rosterArray.map((p: RosterPlayer) => {
    const key = (p.player_name || p.playerName || p.name) as string | undefined;
    const v = key ? valMap.get(key) : undefined;
    return {
      ...p,
      is_bye_week: v?.is_bye_week ?? p.is_bye_week ?? false,
      injury_status: v?.injury_status ?? p.injury_status ?? null,
      injury_duration_weeks: v?.injury_duration_weeks ?? p.injury_duration_weeks ?? 0,
    };
  });
}
