import { useState, useEffect, useCallback, useRef } from "react";
import { getArchetype, scorePlayer, computeVOR, computeTiers } from "@/lib/draft-scoring";
import { supabase } from "@/integrations/supabase/client";

export interface DraftPlayer {
  name: string;
  position: string;
  team: string;
  adp: number;
  byeWeek?: number;
}

export interface DraftPick {
  pickNumber: number;
  round: number;
  pickInRound: number;
  seatNumber: number;
  isUser: boolean;
  player: DraftPlayer;
}

export interface DraftSettings {
  draftId: string;
  draftType: "redraft" | "dynasty";
  scoringType: "ppr" | "half_ppr" | "standard";
  numTeams: number;
  numRounds: number;
  pickTimerSeconds: number;
  userSeat: number;
}

interface DraftState {
  currentOverallPick: number;
  currentRound: number;
  currentPickInRound: number;
  currentSeat: number;
  status: "loading" | "active" | "completed";
}

export function useMockDraft(settings: DraftSettings | null) {
  const [allPlayers, setAllPlayers] = useState<DraftPlayer[]>([]);
  const [availablePlayers, setAvailablePlayers] = useState<DraftPlayer[]>([]);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [draftState, setDraftState] = useState<DraftState>({
    currentOverallPick: 1,
    currentRound: 1,
    currentPickInRound: 1,
    currentSeat: 1,
    status: "loading",
  });
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [latestPick, setLatestPick] = useState<DraftPick | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const aiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Derived state
  const numTeams = settings?.numTeams ?? 12;
  const numRounds = settings?.numRounds ?? 15;
  const userSeat = settings?.userSeat ?? 1;
  const totalPicks = numTeams * numRounds;

  // Snake order: given an overall pick number (1-based), return which seat picks
  const getSeatForPick = useCallback(
    (overallPick: number): number => {
      const round = Math.ceil(overallPick / numTeams);
      const pickInRound = overallPick - (round - 1) * numTeams;
      // Odd rounds: 1→N, Even rounds: N→1
      if (round % 2 === 1) {
        return pickInRound;
      } else {
        return numTeams - pickInRound + 1;
      }
    },
    [numTeams]
  );

  const getRoundForPick = useCallback(
    (overallPick: number) => Math.ceil(overallPick / numTeams),
    [numTeams]
  );

  const getPickInRoundForPick = useCallback(
    (overallPick: number) => {
      const round = Math.ceil(overallPick / numTeams);
      return overallPick - (round - 1) * numTeams;
    },
    [numTeams]
  );

  const isUserTurn = draftState.currentSeat === userSeat && draftState.status === "active";
  const isDraftComplete = draftState.status === "completed";
  const myPicks = picks.filter((p) => p.isUser);

  // Convert Sleeper's positional search_rank into an overall ADP estimate.
  // search_rank is per-position (QB1=1, WR1=1, RB1=1), so we apply
  // position-value curves to interleave them like a real fantasy draft.
  const computeOverallAdp = useCallback(
    (position: string, posRank: number): number => {
      // These curves approximate where each positional rank goes in overall ADP:
      // RBs/WRs go early and interleave, QBs start mid-rounds, TE sparse, K/DEF last
      switch (position) {
        case "RB": return posRank * 2.4 - 0.5;   // RB1≈2, RB2≈4, RB3≈7, etc.
        case "WR": return posRank * 2.4 + 0.8;    // WR1≈3, WR2≈6, WR3≈8, etc.
        case "QB": return posRank * 6.5 + 5;       // QB1≈12, QB2≈18, QB3≈25
        case "TE": return posRank * 11 + 2;         // TE1≈13, TE2≈24, TE3≈35
        case "K":  return 150 + posRank;
        case "DEF": return 140 + posRank;
        default: return 200 + posRank;
      }
    },
    []
  );

  // Fetch players from Sleeper API
  useEffect(() => {
    if (!settings) return;

    const fetchPlayers = async () => {
      try {
        setLoadError(null);

        const DRAFT_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
        let top: DraftPlayer[] = [];

        // --- Primary: trade_values table (FantasyCalc redraft rankings, no external API) ---
        // Get the most recent snapshot date first
        const { data: latestSnapshot } = await (supabase as any)
          .from("trade_values")
          .select("snapshot_date")
          .eq("source", "fantasycalc_redraft")
          .order("snapshot_date", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestSnapshot?.snapshot_date) {
          const { data: tvData } = await (supabase as any)
            .from("trade_values")
            .select("player_name, position, team, rank, bye_week")
            .eq("source", "fantasycalc_redraft")
            .eq("snapshot_date", latestSnapshot.snapshot_date)
            .order("rank", { ascending: true })
            .limit(400);

          if (tvData && tvData.length > 0) {
            // FantasyCalc uses "DST" for team defense; normalise to "DEF"
            top = (tvData as any[])
              .map((p: any) => ({
                name: p.player_name,
                position: p.position === "DST" ? "DEF" : p.position,
                team: p.team || "FA",
                adp: p.rank ?? 999,
                byeWeek: p.bye_week ?? undefined,
              }))
              .filter((p: DraftPlayer) => DRAFT_POSITIONS.includes(p.position))
              .slice(0, 300);
          }
        }

        // --- Fallback: FantasyCalc public JSON API (~50KB, CORS-enabled) ---
        if (top.length === 0) {
          try {
            const fcResp = await fetch(
              "https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&ppr=1&superflex=false"
            );
            if (fcResp.ok) {
              const raw: any[] = await fcResp.json();
              top = raw
                .filter((e) => e?.player?.position && DRAFT_POSITIONS.includes(
                  e.player.position === "DST" ? "DEF" : e.player.position
                ))
                .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
                .slice(0, 300)
                .map((e, idx) => ({
                  name: e.player.name,
                  position: e.player.position === "DST" ? "DEF" : e.player.position,
                  team: e.player.maybeTeam || "FA",
                  adp: idx + 1,
                  byeWeek: e.player.maybeBye ?? undefined,
                }));
            }
          } catch {
            // fall through
          }
        }

        if (top.length === 0) throw new Error("No player data available. Check your connection and try again.");
        setAllPlayers(top);

        // Check for existing picks (resume)
        const { data: existingPicks } = await (supabase as any)
          .from("mock_draft_picks")
          .select("*")
          .eq("draft_id", settings.draftId)
          .order("pick_number", { ascending: true });

        if (existingPicks && existingPicks.length > 0) {
          const draftedNames = new Set(existingPicks.map((p: any) => p.player_name));
          setAvailablePlayers(top.filter((p) => !draftedNames.has(p.name)));

          const resumedPicks: DraftPick[] = existingPicks.map((p: any) => ({
            pickNumber: p.pick_number,
            round: p.round,
            pickInRound: p.pick_in_round,
            seatNumber: p.seat_number,
            isUser: p.is_user,
            player: {
              name: p.player_name,
              position: p.position,
              team: p.team,
              adp: p.adp_rank,
            },
          }));
          setPicks(resumedPicks);

          const nextPick = existingPicks.length + 1;
          if (nextPick > totalPicks) {
            setDraftState({
              currentOverallPick: totalPicks,
              currentRound: numRounds,
              currentPickInRound: numTeams,
              currentSeat: getSeatForPick(totalPicks),
              status: "completed",
            });
          } else {
            setDraftState({
              currentOverallPick: nextPick,
              currentRound: getRoundForPick(nextPick),
              currentPickInRound: getPickInRoundForPick(nextPick),
              currentSeat: getSeatForPick(nextPick),
              status: "active",
            });
          }
        } else {
          setAvailablePlayers(top);
          setDraftState({
            currentOverallPick: 1,
            currentRound: 1,
            currentPickInRound: 1,
            currentSeat: getSeatForPick(1),
            status: "active",
          });
        }
      } catch (err: any) {
        console.error("Failed to load player data:", err);
        setLoadError(err?.message || "Failed to load players");
      } finally {
        setIsLoading(false);
      }
    };

    fetchPlayers();
  }, [settings?.draftId]);

  // Persist a pick to DB
  const persistPick = useCallback(
    async (pick: DraftPick) => {
      if (!settings) return;
      try {
        await (supabase as any).from("mock_draft_picks").insert({
          draft_id: settings.draftId,
          pick_number: pick.pickNumber,
          round: pick.round,
          pick_in_round: pick.pickInRound,
          seat_number: pick.seatNumber,
          is_user: pick.isUser,
          player_name: pick.player.name,
          position: pick.player.position,
          team: pick.player.team,
          adp_rank: pick.player.adp,
        });

        // Update current_pick on the draft
        const nextPick = pick.pickNumber + 1;
        if (nextPick > totalPicks) {
          await (supabase as any)
            .from("mock_drafts")
            .update({ current_pick: pick.pickNumber, status: "completed", completed_at: new Date().toISOString() })
            .eq("id", settings.draftId);
        } else {
          await (supabase as any)
            .from("mock_drafts")
            .update({ current_pick: nextPick })
            .eq("id", settings.draftId);
        }
      } catch (err) {
        console.error("Failed to persist pick:", err);
      }
    },
    [settings, totalPicks]
  );

  // Internal function to execute a pick
  const executePick = useCallback(
    (player: DraftPlayer, isUser: boolean) => {
      const s = settingsRef.current;
      if (!s) return;

      setDraftState((prev) => {
        if (prev.status !== "active") return prev;

        const pick: DraftPick = {
          pickNumber: prev.currentOverallPick,
          round: prev.currentRound,
          pickInRound: prev.currentPickInRound,
          seatNumber: prev.currentSeat,
          isUser,
          player,
        };

        setPicks((p) => [...p, pick]);
        setAvailablePlayers((ap) => ap.filter((pl) => pl.name !== player.name));
        setLatestPick(pick);
        persistPick(pick);

        const nextOverall = prev.currentOverallPick + 1;
        if (nextOverall > numTeams * (s.numRounds)) {
          return { ...prev, status: "completed" as const };
        }

        return {
          currentOverallPick: nextOverall,
          currentRound: getRoundForPick(nextOverall),
          currentPickInRound: getPickInRoundForPick(nextOverall),
          currentSeat: getSeatForPick(nextOverall),
          status: "active" as const,
        };
      });
    },
    [numTeams, persistPick, getSeatForPick, getRoundForPick, getPickInRoundForPick]
  );

  // User makes a pick
  const makePick = useCallback(
    (player: DraftPlayer) => {
      if (!isUserTurn) return;
      executePick(player, true);
    },
    [isUserTurn, executePick]
  );

  // Archetype-aware AI pick logic using shared scoring utility
  const doAiPick = useCallback(() => {
    setPicks((currentPicks) => {
      setDraftState((currentState) => {
        setAvailablePlayers((currentAvailable) => {
          if (currentAvailable.length === 0 || currentState.status !== "active") return currentAvailable;

          const seat = currentState.currentSeat;
          const s = settingsRef.current;
          if (!s) return currentAvailable;

          const teamPicks = currentPicks.filter((p) => p.seatNumber === seat);
          const archetype = getArchetype(seat, s.draftId);

          // Pre-compute VOR and tiers once for this pick decision
          const vorMap = computeVOR(currentAvailable, s.numTeams);
          const tierMap = computeTiers(currentAvailable);

          // Score top candidates (consider top 40 for variety)
          const candidates = currentAvailable.slice(0, 40);
          const scored = candidates.map((player) => {
            const base = scorePlayer(player, {
              availablePlayers: currentAvailable,
              teamPicks,
              allPicks: currentPicks,
              currentRound: currentState.currentRound,
              numTeams: s.numTeams,
              archetype,
              vorMap,
              tierMap,
            });
            // Small randomness so AI teams diverge on close decisions
            return { player, score: base + (Math.random() - 0.5) * 8 };
          });

          scored.sort((a, b) => a.score - b.score);
          const chosen = scored[0].player;

          setTimeout(() => executePick(chosen, false), 0);
          return currentAvailable;
        });
        return currentState;
      });
      return currentPicks;
    });
  }, [executePick]);

  // AI pick automation
  useEffect(() => {
    if (
      draftState.status !== "active" ||
      isLoading ||
      draftState.currentSeat === userSeat
    ) {
      return;
    }

    aiTimeoutRef.current = setTimeout(() => {
      doAiPick();
    }, 350);

    return () => {
      if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current);
    };
  }, [draftState.currentOverallPick, draftState.status, isLoading, userSeat, doAiPick]);

  // Timer logic
  useEffect(() => {
    if (!settings || settings.pickTimerSeconds === 0 || !isUserTurn) {
      setTimeRemaining(0);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    setTimeRemaining(settings.pickTimerSeconds);
    timerRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          // Auto-pick best available
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          setTimeout(() => {
            setAvailablePlayers((current) => {
              if (current.length > 0) {
                setTimeout(() => executePick(current[0], true), 0);
              }
              return current;
            });
          }, 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isUserTurn, settings?.pickTimerSeconds, draftState.currentOverallPick]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current);
    };
  }, []);

  return {
    draftState,
    availablePlayers,
    picks,
    myPicks,
    isUserTurn,
    isDraftComplete,
    timeRemaining,
    makePick,
    isLoading,
    loadError,
    latestPick,
    numTeams,
    numRounds,
    userSeat,
    getSeatForPick,
  };
}
