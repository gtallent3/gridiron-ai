/**
 * NFL Week Detection Utility
 * 
 * Determines the current NFL week based on the calendar date.
 * 
 * Logic:
 * - NFL season runs Week 1-18 from early September to early January
 * - Week rolls over after Monday Night Football (Tuesday 3 AM ET)
 * - If today is Tuesday/Wednesday after MNF, show next week
 * - Otherwise show current week
 */

export enum SeasonState {
  IN_SEASON = 'IN_SEASON',
  POSTSEASON = 'POSTSEASON',
  OFFSEASON = 'OFFSEASON',
  PRE_SEASON = 'PRE_SEASON',
}

export interface NFLWeekInfo {
  week: number;
  season: number;
  label: string;
  isOffseason: boolean;
  seasonState: SeasonState;
}

/**
 * NFL Season Schedule data
 * Each entry: [seasonYear, startDate, endDate]
 * Week 1 starts on startDate, Week 18 ends on endDate
 */
const NFL_SEASONS: { season: number; start: Date; end: Date }[] = [
  { season: 2024, start: new Date('2024-09-05T00:00:00-04:00'), end: new Date('2025-01-07T23:59:59-05:00') },
  { season: 2025, start: new Date('2025-09-04T00:00:00-04:00'), end: new Date('2026-01-09T23:59:59-05:00') },
  { season: 2026, start: new Date('2026-09-10T00:00:00-04:00'), end: new Date('2027-01-08T23:59:59-05:00') },
];

/**
 * Get current NFL week and season
 */
export function getCurrentNFLWeek(): NFLWeekInfo {
  const now = new Date();

  // Find which season window we fall into
  for (const { season, start, end } of NFL_SEASONS) {
    if (now >= start && now <= end) {
      // We're inside this season — calculate the week
      return computeWeek(now, season, start);
    }
  }

  // We're between seasons — figure out if it's postseason or preseason
  // Sort seasons so we can find the gap we're in
  for (let i = 0; i < NFL_SEASONS.length; i++) {
    const curr = NFL_SEASONS[i];
    const next = NFL_SEASONS[i + 1];

    // After this season's end but before next season's start → gap
    if (next && now > curr.end && now < next.start) {
      // January after season end → POSTSEASON (playoffs + Super Bowl)
      // February onwards → OFFSEASON
      const monthOfYear = now.getMonth(); // 0-indexed
      if (monthOfYear === 0) {
        // January: playoffs underway
        return {
          week: 18,
          season: curr.season,
          label: 'Season Complete',
          isOffseason: true,
          seasonState: SeasonState.POSTSEASON,
        };
      }
      // Feb-Aug: offseason
      return {
        week: 1,
        season: next.season,
        label: 'Offseason',
        isOffseason: true,
        seasonState: SeasonState.OFFSEASON,
      };
    }
  }

  // Before all known seasons
  const first = NFL_SEASONS[0];
  if (now < first.start) {
    return {
      week: 1,
      season: first.season,
      label: 'Preseason',
      isOffseason: true,
      seasonState: SeasonState.PRE_SEASON,
    };
  }

  // After all known seasons
  const last = NFL_SEASONS[NFL_SEASONS.length - 1];
  return {
    week: 1,
    season: last.season + 1,
    label: 'Offseason',
    isOffseason: true,
    seasonState: SeasonState.OFFSEASON,
  };
}

function computeWeek(now: Date, season: number, seasonStart: Date): NFLWeekInfo {
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const msSinceStart = now.getTime() - seasonStart.getTime();
  let weeksSinceStart = Math.floor(msSinceStart / msPerWeek);

  // Week rollover logic: Tuesday/Wednesday after MNF rolls to next week
  const dayOfWeek = now.getDay(); // 0=Sunday, 2=Tuesday, 3=Wednesday
  const hourOfDay = now.getHours();

  if (dayOfWeek === 2 && hourOfDay >= 3) {
    weeksSinceStart += 1;
  } else if (dayOfWeek === 3) {
    weeksSinceStart += 1;
  }

  const week = Math.min(weeksSinceStart + 1, 18);

  if (week > 18) {
    return {
      week: 18,
      season,
      label: 'Season Complete',
      isOffseason: true,
      seasonState: SeasonState.POSTSEASON,
    };
  }

  return {
    week,
    season,
    label: `Week ${week}`,
    isOffseason: false,
    seasonState: SeasonState.IN_SEASON,
  };
}

/**
 * Format last updated timestamp
 */
export function formatLastUpdated(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
