/**
 * Stat Source Resolver
 * 
 * Reconciliation rules for multi-source stat ingestion:
 * 1. Prefer actuals over projections
 * 2. Prefer same-provider actuals as league source
 * 3. Cross-provider actuals with small penalty
 * 4. If multiple sources disagree: pick majority, then freshest
 * 5. Store conflict flags for transparency
 */

export interface StatSource {
  source: string; // e.g., 'espn_boxscore', 'sleeper_boxscore', 'yahoo_boxscore'
  type: 'actual' | 'projection' | 'derived';
  freshness_ts: string;
  confidence: number;
  stats: Record<string, number>;
}

export interface ReconciledStat {
  stats: Record<string, number>;
  provenance: StatSource[];
  confidence: number;
  conflict_flags: string[];
  finalized: boolean;
}

interface ReconciliationOptions {
  leagueProvider?: 'espn' | 'sleeper' | 'yahoo'; // Give bonus to same provider as league
  minConfidence?: number;
  preferredSource?: string;
}

/**
 * Reconcile multiple stat sources for a single player/week
 */
export function reconcileStats(
  sources: StatSource[],
  options: ReconciliationOptions = {}
): ReconciledStat {
  const {
    leagueProvider,
    minConfidence = 0.5,
    preferredSource
  } = options;

  if (sources.length === 0) {
    return {
      stats: {},
      provenance: [],
      confidence: 0,
      conflict_flags: ['no_sources_available'],
      finalized: false
    };
  }

  // Filter out low-confidence sources
  const viableSources = sources.filter(s => s.confidence >= minConfidence);
  
  if (viableSources.length === 0) {
    return {
      stats: {},
      provenance: sources,
      confidence: 0,
      conflict_flags: ['all_sources_below_confidence_threshold'],
      finalized: false
    };
  }

  // Sort by priority
  const sortedSources = viableSources.sort((a, b) => {
    // 1. Actuals > Projections > Derived
    const typeScore = { actual: 3, derived: 2, projection: 1 };
    const typeCompare = typeScore[b.type] - typeScore[a.type];
    if (typeCompare !== 0) return typeCompare;

    // 2. Same provider as league gets bonus
    if (leagueProvider) {
      const aMatchesLeague = a.source.includes(leagueProvider) ? 1 : 0;
      const bMatchesLeague = b.source.includes(leagueProvider) ? 1 : 0;
      const providerCompare = bMatchesLeague - aMatchesLeague;
      if (providerCompare !== 0) return providerCompare;
    }

    // 3. Preferred source
    if (preferredSource) {
      const aMatches = a.source === preferredSource ? 1 : 0;
      const bMatches = b.source === preferredSource ? 1 : 0;
      const preferredCompare = bMatches - aMatches;
      if (preferredCompare !== 0) return preferredCompare;
    }

    // 4. Higher confidence
    const confidenceCompare = b.confidence - a.confidence;
    if (Math.abs(confidenceCompare) > 0.01) return confidenceCompare;

    // 5. Freshest data
    return new Date(b.freshness_ts).getTime() - new Date(a.freshness_ts).getTime();
  });

  const primarySource = sortedSources[0];
  const conflictFlags: string[] = [];
  const reconciledStats = { ...primarySource.stats };

  // Check for conflicts across sources
  if (sortedSources.length > 1) {
    const allStats = new Set<string>();
    sortedSources.forEach(s => Object.keys(s.stats).forEach(k => allStats.add(k)));

    allStats.forEach(statKey => {
      const values = sortedSources
        .map(s => s.stats[statKey])
        .filter(v => v !== undefined && v !== null);

      if (values.length > 1) {
        const uniqueValues = [...new Set(values)];
        if (uniqueValues.length > 1) {
          // Conflict detected
          const variance = Math.max(...values) - Math.min(...values);
          if (variance > 0) {
            conflictFlags.push(`${statKey}_conflict: ${uniqueValues.join(' vs ')}`);
            
            // Use majority vote or primary source
            const valueCounts = new Map<number, number>();
            values.forEach(v => valueCounts.set(v, (valueCounts.get(v) || 0) + 1));
            const maxCount = Math.max(...valueCounts.values());
            const majorityValues = [...valueCounts.entries()]
              .filter(([, count]) => count === maxCount)
              .map(([val]) => val);

            if (majorityValues.length === 1) {
              reconciledStats[statKey] = majorityValues[0];
            }
            // else: keep primary source value (already set)
          }
        }
      }
    });
  }

  // Determine if stats are finalized (all sources are actuals and recent)
  const allActuals = sortedSources.every(s => s.type === 'actual');
  const anyRecent = sortedSources.some(s => {
    const age = Date.now() - new Date(s.freshness_ts).getTime();
    return age < 24 * 60 * 60 * 1000; // Within 24 hours
  });
  const finalized = allActuals && anyRecent;

  // Calculate overall confidence (weighted average of top 3 sources)
  const topSources = sortedSources.slice(0, 3);
  const totalWeight = topSources.length;
  const weightedConfidence = topSources.reduce((sum, s) => sum + s.confidence, 0) / totalWeight;

  return {
    stats: reconciledStats,
    provenance: sortedSources,
    confidence: Math.min(weightedConfidence, 1.0),
    conflict_flags: conflictFlags,
    finalized
  };
}

/**
 * Get human-readable freshness badge
 */
export function getFreshnessBadge(sourceType: string, confidence: number, finalized: boolean): string {
  if (finalized && sourceType === 'actual') {
    return confidence >= 0.9 ? 'Actual ✓' : 'Actual';
  }
  if (sourceType === 'actual') {
    return 'Cross-Provider';
  }
  if (sourceType === 'derived') {
    return 'Derived';
  }
  return 'Projection';
}

/**
 * Determine if a stat should trigger a warning in UI
 */
export function shouldWarnProjection(
  sourceType: string,
  weekStatus: 'upcoming' | 'in_progress' | 'completed',
  finalized: boolean
): boolean {
  // Projections are fine for upcoming weeks
  if (weekStatus === 'upcoming') return false;
  
  // Projections during in-progress games are expected
  if (weekStatus === 'in_progress' && sourceType === 'projection') return false;
  
  // Warn if using projections for completed week or not finalized after completion
  return sourceType === 'projection' && weekStatus === 'completed' && !finalized;
}
