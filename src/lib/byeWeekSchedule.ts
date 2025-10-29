// 2025-26 NFL Bye Week Schedule
export const byeWeekSchedule2025 = new Map<string, number>([
  // Week 5
  ['ATL', 5], ['CHI', 5], ['GB', 5], ['PIT', 5],
  // Week 6
  ['HOU', 6], ['MIN', 6],
  // Week 7
  ['BAL', 7], ['BUF', 7],
  // Week 8
  ['ARI', 8], ['DET', 8], ['JAX', 8], ['LV', 8], ['LAR', 8], ['SEA', 8],
  // Week 9
  ['CLE', 9], ['NYJ', 9], ['PHI', 9], ['TB', 9],
  // Week 10
  ['CIN', 10], ['DAL', 10], ['KC', 10], ['TEN', 10],
  // Week 11
  ['IND', 11], ['NO', 11],
  // Week 12
  ['DEN', 12], ['LAC', 12], ['MIA', 12], ['WAS', 12],
  // Week 14
  ['CAR', 14], ['NE', 14], ['NYG', 14], ['SF', 14],
]);

/**
 * Check if a team is on bye for a given week
 */
export function isTeamOnBye(team: string | undefined | null, week: number): boolean {
  if (!team) return false;
  const teamBye = byeWeekSchedule2025.get(team);
  return teamBye === week;
}

/**
 * Get the bye week for a team
 */
export function getTeamByeWeek(team: string | undefined | null): number | null {
  if (!team) return null;
  return byeWeekSchedule2025.get(team) || null;
}
