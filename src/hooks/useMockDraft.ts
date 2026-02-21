import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface DraftPlayer {
  name: string;
  position: string;
  team: string;
  adp: number;
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

  // Fetch players from Sleeper API
  useEffect(() => {
    if (!settings) return;

    const fetchPlayers = async () => {
      try {
        const resp = await fetch("https://api.sleeper.app/v1/players/nfl");
        if (!resp.ok) throw new Error("Failed to fetch");
        const data = await resp.json();

        const ranked: DraftPlayer[] = [];
        for (const [, player] of Object.entries(data) as [string, any][]) {
          if (!player.active || !player.position || !player.search_rank) continue;
          if (!["QB", "RB", "WR", "TE", "K", "DEF"].includes(player.position)) continue;

          ranked.push({
            name: player.full_name || `${player.first_name} ${player.last_name}`,
            position: player.position,
            team: player.team || "FA",
            adp: player.search_rank,
          });
        }

        ranked.sort((a, b) => a.adp - b.adp);
        const top = ranked.slice(0, 300);
        setAllPlayers(top);

        // Check for existing picks (resume)
        const { data: existingPicks } = await supabase
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
      } catch (err) {
        console.error("Failed to load player data:", err);
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
        await supabase.from("mock_draft_picks").insert({
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
          await supabase
            .from("mock_drafts")
            .update({ current_pick: pick.pickNumber, status: "completed", completed_at: new Date().toISOString() })
            .eq("id", settings.draftId);
        } else {
          await supabase
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

  // AI auto-pick
  const doAiPick = useCallback(() => {
    setAvailablePlayers((current) => {
      if (current.length === 0) return current;
      const topN = Math.min(3, current.length);
      const idx = Math.floor(Math.random() * topN);
      const player = current[idx];
      // Schedule the execution outside of the setState
      setTimeout(() => executePick(player, false), 0);
      return current;
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
    latestPick,
    numTeams,
    numRounds,
    userSeat,
    getSeatForPick,
  };
}
