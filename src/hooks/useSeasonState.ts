import { useMemo } from "react";
import { getCurrentNFLWeek, SeasonState } from "@/lib/nflWeekUtils";
import type { NFLWeekInfo } from "@/lib/nflWeekUtils";

export function useSeasonState() {
  const weekInfo = useMemo(() => getCurrentNFLWeek(), []);

  return {
    weekInfo,
    seasonState: weekInfo.seasonState,
    isOffseason: weekInfo.isOffseason,
    isInSeason: weekInfo.seasonState === SeasonState.IN_SEASON,
  };
}
