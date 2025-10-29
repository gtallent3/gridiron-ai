// Helper functions for ESPN projection processing

export const getTeamAbbreviation = (teamId: number): string => {
  const teams: Record<number, string> = {
    1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET',
    9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN',
    17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC',
    25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU'
  };
  return teams[teamId] || 'FA';
};

const POSITION_MAP: Record<number, string> = {
  1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST'
};

export const mapPosition = (val: any): string => {
  const id = typeof val === 'number' ? val : parseInt(String(val || ''), 10);
  return POSITION_MAP[id] || 'FLEX';
};

export function processPlayerStats(
  player: any,
  weekProjection: any,
  normalizedPlayer: any,
  week: number,
  currentSeason: number,
  espnId: string,
  waiverStatus = 'ROSTERED',
  ownership: any = {}
) {
  const rawStats = weekProjection.stats || {};
  const appliedStats = weekProjection.appliedStats || {};
  const position = normalizedPlayer?.position || mapPosition(player.defaultPositionId);
  const isDST = position === 'DST';
  const isK = position === 'K' || player.defaultPositionId === 5;
  const isByeWeek = (!rawStats || Object.keys(rawStats).length === 0) && (!appliedStats || Object.keys(appliedStats).length === 0);

  const normalizedStats: any = { fumbles_lost: parseFloat(rawStats['72']) || 0 };

  if (!isDST && !isK) {
    normalizedStats.passing_yards = parseFloat(rawStats['3']) || 0;
    normalizedStats.passing_tds = parseFloat(rawStats['4']) || 0;
    normalizedStats.interceptions = parseFloat(rawStats['20']) || 0;
    normalizedStats.passing_completions = parseFloat(rawStats['1']) || 0;
    normalizedStats.passing_attempts = parseFloat(rawStats['0']) || 0;
    normalizedStats.passing_2pt_conversions = parseFloat(rawStats['19']) || 0;
    normalizedStats.rushing_yards = parseFloat(rawStats['24']) || 0;
    normalizedStats.rushing_tds = parseFloat(rawStats['25']) || 0;
    normalizedStats.rushing_attempts = parseFloat(rawStats['23']) || 0;
    normalizedStats.rushing_2pt_conversions = parseFloat(rawStats['26']) || 0;
    normalizedStats.receiving_yards = parseFloat(rawStats['42']) || 0;
    normalizedStats.receiving_tds = parseFloat(rawStats['43']) || 0;
    normalizedStats.receptions = parseFloat(rawStats['53']) || 0;
    normalizedStats.receiving_targets = parseFloat(rawStats['58']) || 0;
    normalizedStats.receiving_2pt_conversions = parseFloat(rawStats['44']) || 0;
  }

  if (isDST) {
    normalizedStats.interceptions = parseFloat(rawStats['95']) || 0;
    normalizedStats.sacks = parseFloat(rawStats['99']) || 0;
    normalizedStats.fumbles_recovered = parseFloat(rawStats['96']) || 0;
    normalizedStats.interception_tds = parseFloat(rawStats['103']) || 0;
    normalizedStats.fumble_recovery_tds = parseFloat(rawStats['104']) || 0;
    normalizedStats.defensive_tds = (parseFloat(rawStats['103']) || 0) + (parseFloat(rawStats['104']) || 0);
    normalizedStats.kick_return_tds = parseFloat(rawStats['101']) || 0;
    normalizedStats.punt_return_tds = parseFloat(rawStats['102']) || 0;
    normalizedStats.safeties = parseFloat(rawStats['98']) || 0;
    normalizedStats.blocked_kicks = parseFloat(rawStats['97']) || 0;
  }

  if (isK) {
    normalizedStats.fg_made_0_19 = parseFloat(rawStats['80']) || 0;
    normalizedStats.fg_made_20_29 = parseFloat(rawStats['81']) || 0;
    normalizedStats.fg_made_30_39 = parseFloat(rawStats['82']) || 0;
    normalizedStats.fg_made_40_49 = parseFloat(rawStats['83']) || 0;
    normalizedStats.fg_made_50_plus = parseFloat(rawStats['84']) || 0;
    normalizedStats.xp_made = parseFloat(rawStats['85']) || 0;
  }

  // Calculate projected fantasy points
  let projected_fp: number | undefined;
  
  // Try appliedTotal first (works for most positions including DST)
  if (typeof weekProjection.appliedTotal === 'number') {
    projected_fp = weekProjection.appliedTotal;
  } 
  // Fallback to summing appliedStats if appliedTotal is missing
  else if (appliedStats && Object.keys(appliedStats).length > 0) {
    projected_fp = Object.values(appliedStats).reduce((sum: number, val: any) => {
      const num = typeof val === 'number' ? val : parseFloat(val || '0') || 0;
      return sum + num;
    }, 0);
  }
  // For K/DST with no applied stats but has raw stats, estimate from stats
  else if ((isK || isDST) && rawStats && Object.keys(rawStats).length > 0) {
    if (isK) {
      // Estimate kicker points: 3pts per FG, 1pt per XP (basic scoring)
      const fgMade = (parseFloat(rawStats['80']) || 0) + 
                     (parseFloat(rawStats['81']) || 0) + 
                     (parseFloat(rawStats['82']) || 0) + 
                     (parseFloat(rawStats['83']) || 0) + 
                     (parseFloat(rawStats['84']) || 0);
      const xpMade = parseFloat(rawStats['85']) || 0;
      projected_fp = (fgMade * 3) + xpMade;
    } else {
      // Estimate DST points: basic defensive scoring
      const sacks = parseFloat(rawStats['99']) || 0;
      const ints = parseFloat(rawStats['95']) || 0;
      const fumRec = parseFloat(rawStats['96']) || 0;
      const defTDs = (parseFloat(rawStats['103']) || 0) + (parseFloat(rawStats['104']) || 0);
      const safeties = parseFloat(rawStats['98']) || 0;
      projected_fp = (sacks * 1) + (ints * 2) + (fumRec * 2) + (defTDs * 6) + (safeties * 2);
    }
  }

  return {
    player_id: normalizedPlayer?.player_id || `espn_${espnId}`,
    player_name: normalizedPlayer?.player_name || player.fullName || 'Unknown',
    team: normalizedPlayer?.team || (player.proTeamId ? getTeamAbbreviation(player.proTeamId) : null),
    position: position,
    provider_ids: espnId ? { espn: espnId } : {},
    week: week,
    season: currentSeason,
    source: 'espn_projection',
    stats: normalizedStats,
    confidence: 0.75,
    status_flags: { bye: isByeWeek, inactive: false },
    waiver_status: waiverStatus,
    percent_owned: ownership.percentOwned || (waiverStatus === 'ROSTERED' ? 100 : 0),
    percent_started: ownership.percentStarted || 0,
    projected_fp: projected_fp,
    applied_breakdown: appliedStats,
    last_updated: new Date().toISOString(),
  };
}
