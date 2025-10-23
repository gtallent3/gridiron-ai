// Fantasy Points Calculator - Frontend Utility
// This calculator computes fantasy points based on raw player stats and league scoring settings

export interface PlayerStats {
  passing_yards?: number;
  passing_tds?: number;
  passing_attempts?: number;
  passing_completions?: number;
  interceptions?: number;
  passing_2pt_conversions?: number;
  rushing_yards?: number;
  rushing_tds?: number;
  rushing_attempts?: number;
  rushing_2pt_conversions?: number;
  receptions?: number;
  receiving_yards?: number;
  receiving_tds?: number;
  receiving_targets?: number;
  receiving_2pt_conversions?: number;
  fg_made?: number;
  fg_made_0_19?: number;
  fg_made_20_29?: number;
  fg_made_30_39?: number;
  fg_made_40_49?: number;
  fg_made_50_plus?: number;
  xp_made?: number;
  fumbles_lost?: number;
  sacks?: number;
  fumbles_recovered?: number;
  interception_tds?: number;
  fumble_recovery_tds?: number;
  defensive_tds?: number;
  kick_return_tds?: number;
  punt_return_tds?: number;
  safeties?: number;
  blocked_kicks?: number;
  points_allowed?: number;
  yards_allowed?: number;
}

export interface ScoringSettings {
  // Passing
  passing_yards?: number;
  passing_tds?: number;
  passing_attempts?: number;
  passing_completions?: number;
  interceptions?: number;
  passing_2pt_conversions?: number;
  
  // Rushing
  rushing_yards?: number;
  rushing_tds?: number;
  rushing_attempts?: number;
  rushing_2pt_conversions?: number;
  
  // Receiving
  receptions?: number;
  receiving_yards?: number;
  receiving_tds?: number;
  receiving_targets?: number;
  receiving_2pt_conversions?: number;
  
  // Kicking
  fg_made?: number;
  fg_missed?: number;
  fg_made_0_19?: number;
  fg_made_20_29?: number;
  fg_made_30_39?: number;
  fg_made_40_49?: number;
  fg_made_50_plus?: number;
  xp_made?: number;
  xp_missed?: number;
  
  // Defense
  sacks?: number;
  fumbles_recovered?: number;
  interception_tds?: number;
  fumble_recovery_tds?: number;
  defensive_tds?: number;
  kick_return_tds?: number;
  punt_return_tds?: number;
  safeties?: number;
  blocked_kicks?: number;
  
  // Misc
  fumbles_lost?: number;
  points_allowed_0?: number;
  points_allowed_1_6?: number;
  points_allowed_7_13?: number;
  points_allowed_14_20?: number;
  points_allowed_21_27?: number;
  points_allowed_28_34?: number;
  points_allowed_35_plus?: number;
}

export const DEFAULT_PPR_SCORING: ScoringSettings = {
  passing_yards: 0.04,
  passing_tds: 4,
  interceptions: -2,
  passing_2pt_conversions: 2,
  rushing_yards: 0.1,
  rushing_tds: 6,
  rushing_2pt_conversions: 2,
  receptions: 1, // PPR
  receiving_yards: 0.1,
  receiving_tds: 6,
  receiving_2pt_conversions: 2,
  fg_made_0_19: 3,
  fg_made_20_29: 3,
  fg_made_30_39: 3,
  fg_made_40_49: 4,
  fg_made_50_plus: 5,
  xp_made: 1,
  fumbles_lost: -2,
  sacks: 1,
  fumbles_recovered: 2,
  interception_tds: 6,
  fumble_recovery_tds: 6,
  defensive_tds: 6,
  safeties: 2,
  blocked_kicks: 2,
};

export const DEFAULT_STANDARD_SCORING: ScoringSettings = {
  ...DEFAULT_PPR_SCORING,
  receptions: 0, // Standard - no points for receptions
};

export const DEFAULT_HALF_PPR_SCORING: ScoringSettings = {
  ...DEFAULT_PPR_SCORING,
  receptions: 0.5, // Half PPR
};

export function calculateFantasyPoints(
  stats: PlayerStats,
  scoring: ScoringSettings = DEFAULT_PPR_SCORING
): { total: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let total = 0;

  // Helper function to add points
  const addPoints = (statName: string, statValue: number | undefined, scoringValue: number | undefined) => {
    if (statValue && scoringValue !== undefined) {
      const points = statValue * scoringValue;
      breakdown[statName] = Math.round(points * 100) / 100;
      total += points;
    }
  };

  // Passing
  addPoints('passing_yards', stats.passing_yards, scoring.passing_yards);
  addPoints('passing_tds', stats.passing_tds, scoring.passing_tds);
  addPoints('interceptions', stats.interceptions, scoring.interceptions);
  addPoints('passing_2pt_conversions', stats.passing_2pt_conversions, scoring.passing_2pt_conversions);

  // Rushing
  addPoints('rushing_yards', stats.rushing_yards, scoring.rushing_yards);
  addPoints('rushing_tds', stats.rushing_tds, scoring.rushing_tds);
  addPoints('rushing_2pt_conversions', stats.rushing_2pt_conversions, scoring.rushing_2pt_conversions);

  // Receiving
  addPoints('receptions', stats.receptions, scoring.receptions);
  addPoints('receiving_yards', stats.receiving_yards, scoring.receiving_yards);
  addPoints('receiving_tds', stats.receiving_tds, scoring.receiving_tds);
  addPoints('receiving_2pt_conversions', stats.receiving_2pt_conversions, scoring.receiving_2pt_conversions);

  // Kicking
  addPoints('fg_made_0_19', stats.fg_made_0_19, scoring.fg_made_0_19);
  addPoints('fg_made_20_29', stats.fg_made_20_29, scoring.fg_made_20_29);
  addPoints('fg_made_30_39', stats.fg_made_30_39, scoring.fg_made_30_39);
  addPoints('fg_made_40_49', stats.fg_made_40_49, scoring.fg_made_40_49);
  addPoints('fg_made_50_plus', stats.fg_made_50_plus, scoring.fg_made_50_plus);
  addPoints('xp_made', stats.xp_made, scoring.xp_made);

  // Defense/Special Teams
  addPoints('sacks', stats.sacks, scoring.sacks);
  addPoints('fumbles_recovered', stats.fumbles_recovered, scoring.fumbles_recovered);
  addPoints('interception_tds', stats.interception_tds, scoring.interception_tds);
  addPoints('fumble_recovery_tds', stats.fumble_recovery_tds, scoring.fumble_recovery_tds);
  addPoints('defensive_tds', stats.defensive_tds, scoring.defensive_tds);
  addPoints('kick_return_tds', stats.kick_return_tds, scoring.kick_return_tds);
  addPoints('punt_return_tds', stats.punt_return_tds, scoring.punt_return_tds);
  addPoints('safeties', stats.safeties, scoring.safeties);
  addPoints('blocked_kicks', stats.blocked_kicks, scoring.blocked_kicks);

  // Misc
  addPoints('fumbles_lost', stats.fumbles_lost, scoring.fumbles_lost);

  // Points allowed (DST)
  if (stats.points_allowed !== undefined) {
    let paPoints = 0;
    if (stats.points_allowed === 0) paPoints = scoring.points_allowed_0 || 10;
    else if (stats.points_allowed <= 6) paPoints = scoring.points_allowed_1_6 || 7;
    else if (stats.points_allowed <= 13) paPoints = scoring.points_allowed_7_13 || 4;
    else if (stats.points_allowed <= 20) paPoints = scoring.points_allowed_14_20 || 1;
    else if (stats.points_allowed <= 27) paPoints = scoring.points_allowed_21_27 || 0;
    else if (stats.points_allowed <= 34) paPoints = scoring.points_allowed_28_34 || -1;
    else paPoints = scoring.points_allowed_35_plus || -4;
    
    breakdown.points_allowed = Math.round(paPoints * 100) / 100;
    total += paPoints;
  }

  return {
    total: Math.round(total * 100) / 100,
    breakdown,
  };
}

// Helper to get scoring settings based on scoring type
export function getScoringSettings(scoringType: 'ppr' | 'half_ppr' | 'standard' | 'custom', customSettings?: ScoringSettings): ScoringSettings {
  switch (scoringType) {
    case 'ppr':
      return customSettings ? { ...DEFAULT_PPR_SCORING, ...customSettings } : DEFAULT_PPR_SCORING;
    case 'half_ppr':
      return customSettings ? { ...DEFAULT_HALF_PPR_SCORING, ...customSettings } : DEFAULT_HALF_PPR_SCORING;
    case 'standard':
      return customSettings ? { ...DEFAULT_STANDARD_SCORING, ...customSettings } : DEFAULT_STANDARD_SCORING;
    case 'custom':
      return customSettings || DEFAULT_PPR_SCORING;
    default:
      return DEFAULT_PPR_SCORING;
  }
}
