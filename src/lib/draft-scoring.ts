import { DraftPlayer, DraftPick } from "@/hooks/useMockDraft";

// ---------------------------------------------------------------------------
// Archetype definitions
// ---------------------------------------------------------------------------

export type Archetype =
  | "balanced"
  | "rb_heavy"
  | "zero_rb"
  | "hero_te"
  | "wr_early"
  | "late_qb";

interface ArchetypeWeights {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  K: number;
  DEF: number;
}

// Weight convention: applied as (weight - 1.0) * 40 additive adjustment.
// weight < 1.0 → negative score adjustment → position is MORE attractive
// weight > 1.0 → positive score adjustment → position is LESS attractive
const ARCHETYPE_WEIGHTS: Record<Archetype, ArchetypeWeights> = {
  balanced:  { QB: 1.0, RB: 1.0, WR: 1.0, TE: 1.0, K: 1.0, DEF: 1.0 },
  rb_heavy:  { QB: 1.2, RB: 0.7, WR: 1.1, TE: 1.1, K: 1.0, DEF: 1.0 },
  zero_rb:   { QB: 1.0, RB: 1.4, WR: 0.7, TE: 1.0, K: 1.0, DEF: 1.0 },
  hero_te:   { QB: 1.1, RB: 1.0, WR: 1.1, TE: 0.6, K: 1.0, DEF: 1.0 },
  wr_early:  { QB: 1.1, RB: 1.2, WR: 0.7, TE: 1.1, K: 1.0, DEF: 1.0 },
  late_qb:   { QB: 1.5, RB: 0.95, WR: 0.9, TE: 1.0, K: 1.0, DEF: 1.0 },
};

const ARCHETYPES: Archetype[] = [
  "balanced",
  "rb_heavy",
  "zero_rb",
  "hero_te",
  "wr_early",
  "late_qb",
];

/** Deterministic archetype per seat so resume works across page reloads. */
export function getArchetype(seatNumber: number, draftId: string): Archetype {
  // Hash draftId into a number using simple char code sum
  let hash = 0;
  for (let i = 0; i < draftId.length; i++) {
    hash = (hash * 31 + draftId.charCodeAt(i)) >>> 0;
  }
  const idx = (hash + seatNumber) % ARCHETYPES.length;
  return ARCHETYPES[idx];
}

// ---------------------------------------------------------------------------
// Tier detection
// ---------------------------------------------------------------------------

/** Minimum ADP gap between consecutive players to split into a new tier. */
const TIER_GAP = 9;

/**
 * Returns a map of player name → tier number (1-based) for each position.
 * Tiers are computed from the subset of available players, so they shift as
 * the draft progresses.
 */
export function computeTiers(availablePlayers: DraftPlayer[]): Map<string, number> {
  const byPosition: Record<string, DraftPlayer[]> = {};
  for (const p of availablePlayers) {
    if (!byPosition[p.position]) byPosition[p.position] = [];
    byPosition[p.position].push(p);
  }

  const tierMap = new Map<string, number>();

  for (const players of Object.values(byPosition)) {
    const sorted = [...players].sort((a, b) => a.adp - b.adp);
    let tier = 1;
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i].adp - sorted[i - 1].adp > TIER_GAP) {
        tier++;
      }
      tierMap.set(sorted[i].name, tier);
    }
  }

  return tierMap;
}

// ---------------------------------------------------------------------------
// Value Over Replacement (VOR)
// ---------------------------------------------------------------------------

/** Number of starters per position per team (used to find replacement level). */
const STARTERS_PER_TEAM: Record<string, number> = {
  QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1,
};

/**
 * Returns a VOR map: player name → VOR score.
 * VOR = replacementADP − playerADP. Higher = more valuable.
 * Replacement level = the (numTeams × starters) + 1 ranked player at that position.
 */
export function computeVOR(
  availablePlayers: DraftPlayer[],
  numTeams: number
): Map<string, number> {
  const byPosition: Record<string, DraftPlayer[]> = {};
  for (const p of availablePlayers) {
    if (!byPosition[p.position]) byPosition[p.position] = [];
    byPosition[p.position].push(p);
  }

  const vorMap = new Map<string, number>();

  for (const [pos, players] of Object.entries(byPosition)) {
    const sorted = [...players].sort((a, b) => a.adp - b.adp);
    const startersPerTeam = STARTERS_PER_TEAM[pos] ?? 1;
    const replacementIdx = numTeams * startersPerTeam; // 0-based
    const replacementADP =
      replacementIdx < sorted.length
        ? sorted[replacementIdx].adp
        : (sorted[sorted.length - 1]?.adp ?? 200) + 20;

    for (const p of sorted) {
      vorMap.set(p.name, replacementADP - p.adp);
    }
  }

  return vorMap;
}

// ---------------------------------------------------------------------------
// Positional run detection
// ---------------------------------------------------------------------------

export interface RunInfo {
  position: string;
  count: number;
}

/**
 * Returns positions that are currently "running" (≥ threshold picks in the
 * last windowSize picks).
 */
export function detectPositionalRuns(
  picks: DraftPick[],
  windowSize = 6,
  threshold = 3
): RunInfo[] {
  const recent = picks.slice(-windowSize);
  const counts: Record<string, number> = {};
  for (const pick of recent) {
    counts[pick.player.position] = (counts[pick.player.position] || 0) + 1;
  }
  return Object.entries(counts)
    .filter(([, count]) => count >= threshold)
    .map(([position, count]) => ({ position, count }));
}

// ---------------------------------------------------------------------------
// Roster targets
// ---------------------------------------------------------------------------

export const POS_TARGETS: Record<string, number> = {
  QB: 2, RB: 5, WR: 5, TE: 2, K: 1, DEF: 1,
};

// ---------------------------------------------------------------------------
// Unified scoring context
// ---------------------------------------------------------------------------

export interface ScoringContext {
  /** All players still available (sorted by ADP). */
  availablePlayers: DraftPlayer[];
  /** Picks already made by the team being scored for. */
  teamPicks: DraftPick[];
  /** All picks in the draft so far (for run detection). */
  allPicks: DraftPick[];
  /** Current round (1-based). */
  currentRound: number;
  /** Number of teams in the draft. */
  numTeams: number;
  /** Archetype for this team. */
  archetype: Archetype;
  /** Pre-computed VOR map (optional — computed internally if omitted). */
  vorMap?: Map<string, number>;
  /** Pre-computed tier map (optional — computed internally if omitted). */
  tierMap?: Map<string, number>;
}

/**
 * Score a player for a given team/context. Lower score = better pick.
 * Designed to be used by both AI pick logic and user recommendations.
 */
export function scorePlayer(
  player: DraftPlayer,
  ctx: ScoringContext
): number {
  const {
    availablePlayers,
    teamPicks,
    allPicks,
    currentRound,
    numTeams,
    archetype,
  } = ctx;

  const vorMap = ctx.vorMap ?? computeVOR(availablePlayers, numTeams);
  const tierMap = ctx.tierMap ?? computeTiers(availablePlayers);

  const posCounts: Record<string, number> = {};
  for (const p of teamPicks) {
    posCounts[p.player.position] = (posCounts[p.player.position] || 0) + 1;
  }

  const count = posCounts[player.position] || 0;
  const target = POS_TARGETS[player.position] ?? 2;
  const weights = ARCHETYPE_WEIGHTS[archetype];
  const archetypeWeight = weights[player.position as keyof ArchetypeWeights] ?? 1.0;

  // Start with negative VOR (higher VOR → lower score → better pick)
  const vor = vorMap.get(player.name) ?? 0;
  let score = -vor;

  // Archetype modifier — additive so it works correctly regardless of VOR sign.
  // weight < 1.0 → negative adjustment → more attractive for this archetype
  // weight > 1.0 → positive adjustment → less attractive for this archetype
  score += (archetypeWeight - 1.0) * 40;

  // Tier bonus: being the last player in a tier triggers urgency
  const tier = tierMap.get(player.name) ?? 99;
  const playersInSameTierAndPos = availablePlayers.filter(
    (p) => p.position === player.position && (tierMap.get(p.name) ?? 99) === tier
  );
  if (playersInSameTierAndPos.length === 1) {
    // Last player in their tier — boost priority
    score -= 20;
  }

  // Position need penalties
  if (count >= target) {
    score += 150;
  } else if (count >= target - 1) {
    score += 30;
  }

  // K and DEF wait until late rounds
  if ((player.position === "K" || player.position === "DEF") && currentRound < 10) {
    score += 200;
  }

  // Positional run reaction: if a run is happening on this position, add urgency
  const runs = detectPositionalRuns(allPicks);
  const runForThisPos = runs.find((r) => r.position === player.position);
  if (runForThisPos && count < target) {
    score -= 15 * (runForThisPos.count - 2); // more urgency the bigger the run
  }

  return score;
}

// ---------------------------------------------------------------------------
// Suggestion reason strings
// ---------------------------------------------------------------------------

export interface SuggestionReason {
  text: string;
  /** "urgent" shows in amber, "normal" in muted, "value" in green */
  tone: "urgent" | "normal" | "value";
}

export function getSuggestionReason(
  player: DraftPlayer,
  ctx: ScoringContext
): SuggestionReason {
  const {
    availablePlayers,
    teamPicks,
    allPicks,
    currentRound,
    numTeams,
  } = ctx;

  const vorMap = ctx.vorMap ?? computeVOR(availablePlayers, numTeams);
  const tierMap = ctx.tierMap ?? computeTiers(availablePlayers);

  const posCounts: Record<string, number> = {};
  for (const p of teamPicks) {
    posCounts[p.player.position] = (posCounts[p.player.position] || 0) + 1;
  }

  const count = posCounts[player.position] || 0;
  const target = POS_TARGETS[player.position] ?? 2;
  const tier = tierMap.get(player.name) ?? 99;
  const vor = vorMap.get(player.name) ?? 0;
  const runs = detectPositionalRuns(allPicks);
  const runForThisPos = runs.find((r) => r.position === player.position);

  // Last in tier — urgent
  const playersInSameTierAndPos = availablePlayers.filter(
    (p) => p.position === player.position && (tierMap.get(p.name) ?? 99) === tier
  );
  if (playersInSameTierAndPos.length === 1) {
    return {
      text: `Last Tier ${tier} ${player.position} available`,
      tone: "urgent",
    };
  }

  // Positional run in progress — urgent
  if (runForThisPos && count < target) {
    return {
      text: `${player.position} run — ${runForThisPos.count} taken in last 6 picks`,
      tone: "urgent",
    };
  }

  // Strong VOR value — green
  if (vor > 20) {
    const adpDiff = Math.round(vor);
    return {
      text: `+${adpDiff} ADP value vs replacement`,
      tone: "value",
    };
  }

  // First at position — normal
  if (count === 0) {
    return {
      text: `First ${player.position} — fill a key need`,
      tone: "normal",
    };
  }

  // Building depth — normal
  if (count < target - 1) {
    return {
      text: `${player.position} depth (${count}/${target})`,
      tone: "normal",
    };
  }

  // Late round K/DEF — normal
  if (currentRound >= 10 && (player.position === "K" || player.position === "DEF")) {
    return {
      text: `Good round to secure ${player.position}`,
      tone: "normal",
    };
  }

  // Fallback: tier info
  return {
    text: `Tier ${tier} ${player.position} — ADP ${player.adp}`,
    tone: "normal",
  };
}
