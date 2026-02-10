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
 * 2025 NFL Season Schedule (approximate)
 * Week 1: Sept 4-10, 2025 (adjusted to match current week 9 on Oct 30)
 * Week 18: Jan 5-9, 2026
 */
const NFL_2025_START = new Date('2025-09-04T00:00:00-04:00'); // Week 1 starts Sept 4
const NFL_2025_END = new Date('2026-01-09T23:59:59-05:00'); // Week 18 end

/**
 * Get current NFL week and season
 */
export function getCurrentNFLWeek(): NFLWeekInfo {
  const now = new Date();
  const currentYear = now.getFullYear();
  
  // Determine if we're in the 2024 or 2025 season
  // NFL season starts in September and ends in January of next year
  let seasonStart: Date;
  let season: number;
  
  if (now >= NFL_2025_START && now <= NFL_2025_END) {
    // 2025 season
    seasonStart = NFL_2025_START;
    season = 2025;
  } else if (now < NFL_2025_START) {
    // Before 2025 season - use 2024 season dates
    seasonStart = new Date('2024-09-05T00:00:00-04:00');
    season = 2024;
  } else {
    // After 2025 season - offseason
    return {
      week: 1,
      season: 2026,
      label: 'Offseason',
      isOffseason: true,
      seasonState: SeasonState.OFFSEASON,
    };
  }
  
  // Check if we're before season start
  if (now < seasonStart) {
    return {
      week: 1,
      season,
      label: 'Preseason',
      isOffseason: true,
      seasonState: SeasonState.PRE_SEASON,
    };
  }
  
  // Calculate weeks since season start
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const msSinceStart = now.getTime() - seasonStart.getTime();
  let weeksSinceStart = Math.floor(msSinceStart / msPerWeek);
  
  // Week rollover logic: Tuesday/Wednesday after MNF rolls to next week
  const dayOfWeek = now.getDay(); // 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday
  const hourOfDay = now.getHours();
  
  // If it's Tuesday morning (after 3 AM) or Wednesday, advance to next week
  if (dayOfWeek === 2 && hourOfDay >= 3) {
    weeksSinceStart += 1;
  } else if (dayOfWeek === 3) {
    weeksSinceStart += 1;
  }
  
  // Current week is weeksSinceStart + 1 (Week 1 is first week)
  const week = Math.min(weeksSinceStart + 1, 18);
  
  // If we've gone past Week 18, we're in offseason
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
