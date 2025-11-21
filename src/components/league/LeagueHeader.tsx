import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Trophy, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ManualSyncButton } from "./ManualSyncButton";
import { calculateFantasyPoints } from "@/lib/fantasyPointsCalculator";
import { getCurrentNFLWeek } from "@/lib/nflWeekUtils";

type League = {
  id: string;
  platform: string;
  league_name: string;
  league_size: number;
  scoring_type: string;
  scoring_settings?: any;
  opponent_team_id?: string;
  current_week?: number;
};

type Team = {
  team_name: string;
  roster: any;
  wins?: number;
  losses?: number;
  ties?: number;
  total_projected?: number;
} | null;

type LeagueHeaderProps = {
  league: League;
  userTeam: Team;
  onSyncComplete?: () => void;
};

export function LeagueHeader({ league, userTeam, onSyncComplete }: LeagueHeaderProps) {
  const [winProbability, setWinProbability] = useState(50);
  const [projectedPoints, setProjectedPoints] = useState(0);

  useEffect(() => {
    const fetchWinProbability = async () => {
      if (!league.opponent_team_id || league.platform !== 'espn') return;

      // Fetch opponent team roster
      const { data: opponentTeam } = await supabase
        .from('user_teams')
        .select('roster')
        .eq('league_id', league.id)
        .eq('team_id', league.opponent_team_id)
        .maybeSingle();

      if (!opponentTeam || !userTeam?.roster) return;

      try {
        const STARTER_SLOTS = [0, 2, 4, 5, 6, 16, 17, 23];
        const currentWeek = league.current_week || getCurrentNFLWeek().week;
        const now = new Date();
        const inferredSeason = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;

        // Get starters from both teams
        const userStarters = (Array.isArray(userTeam.roster) ? userTeam.roster : [])
          .filter((p: any) => STARTER_SLOTS.includes(p.slot));
        const oppStarters = (Array.isArray(opponentTeam.roster) ? opponentTeam.roster : [])
          .filter((p: any) => STARTER_SLOTS.includes(p.slot));

        // Get all ESPN IDs
        const userStarterIds = userStarters.map((p: any) => String(p.player_id ?? '')).filter(Boolean);
        const oppStarterIds = oppStarters.map((p: any) => String(p.player_id ?? '')).filter(Boolean);
        const allStarterIds = [...userStarterIds, ...oppStarterIds];

        if (allStarterIds.length === 0) return;

        // Fetch canonical players
        const { data: canonicalPlayers } = await supabase
          .from('canonical_players')
          .select('id, espn_id, position')
          .in('espn_id', allStarterIds);

        if (!canonicalPlayers?.length) return;

        const canonicalIds = canonicalPlayers.map(p => p.id);

        // Fetch player pool data - prioritize actual stats
        const { data: playerPoolData } = await supabase
          .from('player_pool_v2')
          .select('*')
          .in('canonical_player_id', canonicalIds)
          .eq('week', currentWeek)
          .eq('season', inferredSeason)
          .order('actual_fp', { ascending: false, nullsFirst: false });

        if (!playerPoolData?.length) return;

        // Create map, preferring actual stats over projected
        const poolMap = new Map<string, any>();
        for (const pool of playerPoolData) {
          const existing = poolMap.get(pool.canonical_player_id);
          if (!existing || (Number(pool.actual_fp) > 0 && Number(existing.actual_fp) === 0)) {
            poolMap.set(pool.canonical_player_id, pool);
          }
        }

        // Get league scoring settings
        const { data: leagueData } = await supabase
          .from('connected_leagues')
          .select('scoring_settings, scoring_type')
          .eq('id', league.id)
          .single();

        let scoringSettings: any = {
          passing_yards: 0.04, passing_tds: 4, interceptions: -2,
          rushing_yards: 0.1, rushing_tds: 6,
          receptions: 1, receiving_yards: 0.1, receiving_tds: 6,
          fumbles_lost: -2,
        };

        if (leagueData?.scoring_settings) {
          scoringSettings = { ...scoringSettings, ...(leagueData.scoring_settings as Record<string, any>) };
        } else if (leagueData?.scoring_type === 'standard') {
          scoringSettings.receptions = 0;
        } else if (leagueData?.scoring_type === 'half_ppr') {
          scoringSettings.receptions = 0.5;
        }

        // Create map from ESPN ID to canonical player and pool data
        const espnToData = new Map<string, { canonical: any, pool: any }>();
        canonicalPlayers.forEach(cp => {
          if (cp.espn_id) {
            const poolEntry = poolMap.get(cp.id);
            if (poolEntry) {
              espnToData.set(cp.espn_id, { canonical: cp, pool: poolEntry });
            }
          }
        });

        // Calculate user projected
        let userTotal = 0;
        userStarterIds.forEach(espnId => {
          const data = espnToData.get(espnId);
          if (data) {
            const { pool } = data;
            const hasActualStats = Number(pool.actual_fp) > 0;
            
            const stats = {
              passing_yards: Number(pool.passing_yards) || 0,
              passing_tds: Number(pool.passing_tds) || 0,
              interceptions: Number(pool.passing_ints) || 0,
              rushing_yards: Number(pool.rushing_yards) || 0,
              rushing_tds: Number(pool.rushing_tds) || 0,
              receptions: Number(pool.receptions) || 0,
              receiving_yards: Number(pool.receiving_yards) || 0,
              receiving_tds: Number(pool.receiving_tds) || 0,
            };
            const { total } = calculateFantasyPoints(stats, scoringSettings);
            userTotal += total;
          }
        });

        // Calculate opponent projected
        let oppTotal = 0;
        oppStarterIds.forEach(espnId => {
          const data = espnToData.get(espnId);
          if (data) {
            const { pool } = data;
            const hasActualStats = Number(pool.actual_fp) > 0;
            
            const stats = {
              passing_yards: Number(pool.passing_yards) || 0,
              passing_tds: Number(pool.passing_tds) || 0,
              interceptions: Number(pool.passing_ints) || 0,
              rushing_yards: Number(pool.rushing_yards) || 0,
              rushing_tds: Number(pool.rushing_tds) || 0,
              receptions: Number(pool.receptions) || 0,
              receiving_yards: Number(pool.receiving_yards) || 0,
              receiving_tds: Number(pool.receiving_tds) || 0,
            };
            const { total } = calculateFantasyPoints(stats, scoringSettings);
            oppTotal += total;
          }
        });

        const totalProjected = userTotal + oppTotal;
        const calculatedWinProb = totalProjected > 0 
          ? Math.round((userTotal / totalProjected) * 100) 
          : 50;
        setWinProbability(calculatedWinProb);
      } catch (error) {
        console.error('Error calculating win probability:', error);
      }
    };

    fetchWinProbability();
  }, [league.id, league.opponent_team_id, league.platform, league.current_week, userTeam?.roster]);

  // Calculate projected points using the same logic as RosterView for ESPN
  useEffect(() => {
    const calculateProjectedPoints = async () => {
      const roster = userTeam?.roster;
      if (!Array.isArray(roster)) {
        setProjectedPoints(0);
        return;
      }

      // For non-ESPN, use simple calculation from roster data
      if (league.platform === 'sleeper' || league.platform === 'yahoo') {
        const points = roster
          .filter((p: any) => {
            if (league.platform === 'yahoo') {
              const sp = String(p.selected_position ?? '').toUpperCase();
              return sp !== '' && !['BN','BENCH','IR','NA','IL','PUP'].includes(sp);
            }
            return p.starter !== false;
          })
          .reduce((sum: number, p: any) => sum + (p.projected || 0), 0);
        setProjectedPoints(points);
        return;
      }

      // For ESPN, calculate using league-specific scoring settings (same as RosterView)
      try {
        const STARTER_SLOTS = [0, 2, 4, 5, 6, 16, 17, 23];
        const currentWeek = league.current_week || getCurrentNFLWeek().week;
        const now = new Date();
        const inferredSeason = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
        
        // Get starter player IDs
        const starterPlayers = roster.filter((p: any) => STARTER_SLOTS.includes(p.slot));
        const platformIdField = 'espn_id';
        const rosterPlayerIds = starterPlayers
          .map((p: any) => String(p.player_id ?? p.playerId ?? p.id ?? ''))
          .filter(Boolean);
        
        // Look up canonical players
        const { data: canonicalData } = await supabase
          .from('canonical_players')
          .select('id, player_name, position, team, espn_id')
          .in(platformIdField, rosterPlayerIds);
        
        const canonicalMap = new Map<string, any>();
        if (canonicalData) {
          for (const cp of canonicalData) {
            if (cp.espn_id) {
              canonicalMap.set(String(cp.espn_id), cp);
            }
          }
        }
        
        const canonicalIds = Array.from(canonicalMap.values()).map(cp => cp.id);
        
        // Fetch from player_pool_v2 - prioritize actual stats
        const { data: poolData } = await supabase
          .from('player_pool_v2')
          .select('*')
          .eq('week', currentWeek)
          .eq('season', inferredSeason)
          .in('canonical_player_id', canonicalIds)
          .order('actual_fp', { ascending: false, nullsFirst: false });
        
        const poolMap = new Map<string, any>();
        if (poolData) {
          for (const pool of poolData) {
            const existing = poolMap.get(pool.canonical_player_id);
            if (!existing || (Number(pool.actual_fp) > 0 && Number(existing.actual_fp) === 0)) {
              poolMap.set(pool.canonical_player_id, pool);
            }
          }
        }
        
        // Get scoring settings
        const { data: leagueData } = await supabase
          .from('connected_leagues')
          .select('scoring_settings, scoring_type')
          .eq('id', league.id)
          .maybeSingle();
        
        let scoringSettings: any = {
          passing_yards: 0.04, passing_tds: 4, interceptions: -2,
          rushing_yards: 0.1, rushing_tds: 6,
          receptions: 1, receiving_yards: 0.1, receiving_tds: 6,
          fumbles_lost: -2,
        };
        
        if (leagueData?.scoring_settings) {
          scoringSettings = { ...scoringSettings, ...(leagueData.scoring_settings as Record<string, any>) };
        } else if (leagueData?.scoring_type === 'standard') {
          scoringSettings.receptions = 0;
        } else if (leagueData?.scoring_type === 'half_ppr') {
          scoringSettings.receptions = 0.5;
        }
        
        // Calculate projected points for each starter
        let totalProjected = 0;
        starterPlayers.forEach((player: any) => {
          const playerId = String(player.player_id ?? player.playerId ?? player.id ?? '');
          const canonical = canonicalMap.get(playerId);
          const poolEntry = canonical ? poolMap.get(canonical.id) : null;
          
          if (poolEntry) {
            const stats = {
              passing_yards: Number(poolEntry.passing_yards) || 0,
              passing_tds: Number(poolEntry.passing_tds) || 0,
              interceptions: Number(poolEntry.passing_ints) || 0,
              rushing_yards: Number(poolEntry.rushing_yards) || 0,
              rushing_tds: Number(poolEntry.rushing_tds) || 0,
              receptions: Number(poolEntry.receptions) || 0,
              receiving_yards: Number(poolEntry.receiving_yards) || 0,
              receiving_tds: Number(poolEntry.receiving_tds) || 0,
            } as Record<string, number>;

            const { total } = calculateFantasyPoints(stats, scoringSettings);
            
            totalProjected += total;
          }
        });
        
        setProjectedPoints(totalProjected);
      } catch (error) {
        console.error('Error calculating projected points:', error);
        // Fallback to simple calculation
        const STARTER_SLOTS = [0, 2, 4, 6, 16, 17, 23];
        const points = roster
          .filter((p: any) => STARTER_SLOTS.includes(p.slot))
          .reduce((sum: number, p: any) => sum + (p.projected || 0), 0);
        setProjectedPoints(points);
      }
    };

    calculateProjectedPoints();
  }, [league.id, league.platform, league.current_week, userTeam?.roster]);

  // Get actual team record from userTeam data
  const record = {
    wins: userTeam?.wins || 0,
    losses: userTeam?.losses || 0,
    ties: userTeam?.ties || 0
  };

  // Derive scoring type from ESPN scoring settings when available (statId 53 = receptions)
  const displayScoringType = (() => {
    const defaultType = league.scoring_type;
    const settings = (league as any).scoring_settings;
    if (league.platform !== 'espn' || !settings) return defaultType;

    const items = settings.scoringItems;
    if (!items) return defaultType;

    let recPoints: number | undefined;
    if (Array.isArray(items)) {
      const recItem = items.find((it: any) => it?.statId === 53);
      recPoints = recItem?.points ?? recItem?.value;
    } else if (typeof items === 'object') {
      const candidate = items['53'] ?? items[53];
      recPoints = candidate?.points ?? candidate?.value ?? candidate;
    }

    if (typeof recPoints !== 'number') return defaultType;
    if (recPoints === 1 || recPoints === 1.0) return 'ppr';
    if (recPoints === 0.5) return 'half_ppr';
    if (recPoints === 0) return 'standard';
    return 'custom';
  })();

  return (
    <Card className="border-2 border-primary/50 bg-gradient-to-r from-primary/5 to-accent/5">
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:gap-6">
          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold">{league.league_name}</h1>
                <Badge variant="outline" className="uppercase w-fit">
                  {league.platform}
                </Badge>
              </div>
              <ManualSyncButton leagueId={league.id} onSyncComplete={onSyncComplete} />
            </div>
            {userTeam && (
              <p className="text-base sm:text-lg lg:text-xl text-muted-foreground">
                {userTeam.team_name}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs sm:text-sm">
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-primary" />
                <span className="font-semibold">
                  {record.wins}-{record.losses}{record.ties ? `-${record.ties}` : ''}
                </span>
              </div>
              <span className="text-muted-foreground">•</span>
              <span className="text-muted-foreground">
                {league.league_size} Teams
              </span>
              <span className="text-muted-foreground">•</span>
              <span className="text-muted-foreground capitalize">
                {displayScoringType.replace('_', ' ')}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <Card className="bg-background/50">
              <CardContent className="p-3 sm:p-4 text-center">
                <p className="text-xs sm:text-sm text-muted-foreground mb-1">Projected Points</p>
                <p className="text-xl sm:text-2xl lg:text-3xl font-bold text-primary">
                  {projectedPoints > 0 ? projectedPoints.toFixed(1) : 'N/A'}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-background/50">
              <CardContent className="p-3 sm:p-4 text-center">
                <p className="text-xs sm:text-sm text-muted-foreground mb-1">Win Probability</p>
                <div className="flex items-center justify-center gap-1 sm:gap-2">
                  <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-green-500" />
                  <p className="text-xl sm:text-2xl lg:text-3xl font-bold text-green-500">{winProbability}%</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
