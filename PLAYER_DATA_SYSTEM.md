# Player Data System - Dynamic Fantasy Points Calculation

## Overview

The Gridiron AI platform now features a **stat-driven player data system** that:
- Fetches raw player statistics from ESPN, Sleeper, and Yahoo
- Stores normalized stats in a structured database
- Dynamically calculates fantasy points based on each league's specific scoring settings
- Provides a unified API for all tools (Trade Analyzer, Start/Sit, Projections, etc.)

## Architecture

### Database Schema

#### `player_stats` Table
Stores raw player statistics for every player, week, and season:

```typescript
{
  player_id: string;        // Normalized player ID
  player_name: string;
  team: string;             // Team abbreviation (e.g., 'BUF', 'KC')
  position: string;         // Player position
  week: number;             // NFL week (1-18)
  season: number;           // NFL season year
  
  // Passing stats
  passing_yards: number;
  passing_tds: number;
  passing_attempts: number;
  passing_completions: number;
  interceptions: number;
  passing_2pt_conversions: number;
  
  // Rushing stats
  rushing_yards: number;
  rushing_tds: number;
  rushing_attempts: number;
  rushing_2pt_conversions: number;
  
  // Receiving stats
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  receiving_targets: number;
  receiving_2pt_conversions: number;
  
  // Kicking stats
  fg_made_0_19: number;
  fg_made_20_29: number;
  fg_made_30_39: number;
  fg_made_40_49: number;
  fg_made_50_plus: number;
  xp_made: number;
  
  // Defense/Special Teams stats
  sacks: number;
  fumbles_recovered: number;
  interception_tds: number;
  fumble_recovery_tds: number;
  defensive_tds: number;
  kick_return_tds: number;
  punt_return_tds: number;
  safeties: number;
  blocked_kicks: number;
  points_allowed: number;
  yards_allowed: number;
  
  // Misc
  fumbles_lost: number;
  
  // Metadata
  source: string;           // 'ESPN', 'Sleeper', or 'Yahoo'
  raw_data: jsonb;          // Original API response
  created_at: timestamp;
  updated_at: timestamp;
}
```

### API Endpoint

#### `GET /functions/v1/get-player-data`

Fetches player data with dynamically calculated fantasy points.

**Query Parameters:**
- `week` (optional): NFL week number (1-18)
- `season` (optional): NFL season year (defaults to current season)
- `leagueId` (optional): League ID to use league-specific scoring settings
- `playerIds` (optional): Comma-separated list of player IDs to filter

**Response:**
```json
{
  "players": [
    {
      "player_id": "1234",
      "player_name": "Josh Allen",
      "team": "BUF",
      "position": "QB",
      "week": 7,
      "season": 2024,
      "stats": {
        "passing_yards": 312,
        "passing_tds": 3,
        "interceptions": 1,
        "rushing_yards": 38,
        "rushing_tds": 0
      },
      "fantasy_points": 26.68,
      "points_breakdown": {
        "passing_yards": 12.48,
        "passing_tds": 12,
        "interceptions": -2,
        "rushing_yards": 3.8,
        "rushing_tds": 0
      },
      "source": "ESPN",
      "last_updated": "2025-10-21T14:00:00Z"
    }
  ],
  "scoring_settings": { ... },
  "total_players": 1
}
```

## Fantasy Points Calculator

### Frontend Utility

The calculator is available as a frontend utility in `src/lib/fantasyPointsCalculator.ts`:

```typescript
import { calculateFantasyPoints, DEFAULT_PPR_SCORING } from '@/lib/fantasyPointsCalculator';

const stats = {
  passing_yards: 255,
  passing_tds: 2,
  interceptions: 1,
  rushing_yards: 23,
  rushing_tds: 0
};

const { total, breakdown } = calculateFantasyPoints(stats, DEFAULT_PPR_SCORING);
// total: 19.2
// breakdown: { passing_yards: 10.2, passing_tds: 8, ... }
```

### Scoring Settings

**Built-in Presets:**
- `DEFAULT_PPR_SCORING` - Full point per reception
- `DEFAULT_HALF_PPR_SCORING` - Half point per reception
- `DEFAULT_STANDARD_SCORING` - No points for receptions

**Custom Scoring:**
```typescript
const customScoring = {
  passing_yards: 0.04,
  passing_tds: 6,    // Custom: 6 points per passing TD
  interceptions: -3, // Custom: -3 for INTs
  rushing_yards: 0.1,
  rushing_tds: 6,
  receptions: 1,
  receiving_yards: 0.1,
  receiving_tds: 6,
};

const { total } = calculateFantasyPoints(stats, customScoring);
```

## React Hook

Use the `usePlayerData` hook to fetch player data in components:

```typescript
import { usePlayerData } from '@/hooks/usePlayerData';

function MyComponent() {
  const { data, loading, error, refetch } = usePlayerData({
    week: 7,
    season: 2024,
    leagueId: 'abc123',
    playerIds: ['player1', 'player2'],
    enabled: true,
  });

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      {data.map(player => (
        <div key={player.player_id}>
          {player.player_name}: {player.fantasy_points} pts
        </div>
      ))}
    </div>
  );
}
```

## Integration Examples

### Trade Analyzer

Instead of using pre-calculated points from ESPN:
```typescript
// OLD WAY
const espnPoints = player.projected;

// NEW WAY
const { data } = usePlayerData({
  playerIds: [player.player_id],
  leagueId: currentLeague.id,
  week: currentWeek,
});
const fantasyPoints = data[0]?.fantasy_points || 0;
```

### Start/Sit Recommendations

```typescript
const { data: playerStats } = usePlayerData({
  playerIds: roster.map(p => p.player_id),
  leagueId: league.id,
});

// playerStats now contains accurate fantasy points based on league scoring
const sortedByPoints = playerStats.sort((a, b) => b.fantasy_points - a.fantasy_points);
```

### Custom Projections

```typescript
import { calculateFantasyPoints, getScoringSettings } from '@/lib/fantasyPointsCalculator';

// Get league-specific scoring
const scoring = getScoringSettings(league.scoring_type, league.scoring_settings);

// Calculate points for custom stat projections
const projectedStats = {
  passing_yards: 280,
  passing_tds: 2,
  interceptions: 1,
};

const { total } = calculateFantasyPoints(projectedStats, scoring);
```

## Data Flow

1. **Sync Process** (Weekly, Post-MNF):
   ```
   ESPN/Sleeper/Yahoo API 
   → Fetch raw player stats
   → Normalize player IDs
   → Store in player_stats table
   ```

2. **Query Process** (On-Demand):
   ```
   Frontend/Tool Request
   → get-player-data edge function
   → Fetch stats from player_stats
   → Fetch league scoring settings
   → Calculate fantasy points
   → Return computed data
   ```

3. **Cache Strategy**:
   - Raw stats cached in database
   - Fantasy points computed on-the-fly
   - Refresh stats every Tuesday after games

## Scoring Type Detection

The system automatically detects scoring type from league settings:

```typescript
// ESPN League
if (receptionPoints === 1.0) → 'ppr'
if (receptionPoints === 0.5) → 'half_ppr'
if (receptionPoints === 0) → 'standard'

// Sleeper/Yahoo
// Similar detection based on their API structure
```

## Benefits

1. **Accuracy**: Fantasy points always match league-specific scoring
2. **Flexibility**: Support any custom scoring format
3. **Consistency**: Single source of truth for all tools
4. **Performance**: Cached stats, computed points on-demand
5. **Transparency**: See exact point breakdown per stat category

## Migration Notes

### Backward Compatibility

The system maintains backward compatibility with existing code:
- `player_valuations` table still exists for projections
- Old tools still work using ESPN's pre-calculated points
- New tools can gradually adopt the new system

### Gradual Migration

Tools should migrate in this order:
1. ✅ Trade Analyzer (uses dynamic calculation)
2. ✅ Start/Sit Recommendations (uses dynamic calculation)
3. 🔄 Roster View (update to use player_stats)
4. 🔄 Matchup Insights (update to use player_stats)
5. 🔄 Waiver Wire (update to use player_stats)

## Future Enhancements

- [ ] Automated weekly stat sync (cron job)
- [ ] Historical stat trends and analysis
- [ ] Player comparison tool using raw stats
- [ ] Custom stat categories (superflex, IDP, etc.)
- [ ] Real-time stat updates during games
- [ ] Advanced analytics (target share, snap count, etc.)

## Support

For questions or issues with the player data system:
1. Check edge function logs in Lovable Cloud
2. Verify player_stats table has recent data
3. Ensure league scoring_settings are properly synced
4. Test with the get-player-data endpoint directly

---

**Last Updated**: October 2025
**Version**: 1.0.0
