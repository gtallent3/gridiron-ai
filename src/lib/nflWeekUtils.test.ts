import { describe, it, expect, vi, afterEach } from "vitest";
import { getCurrentNFLWeek, SeasonState, formatLastUpdated } from "./nflWeekUtils";

describe("getCurrentNFLWeek", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns IN_SEASON during regular season", () => {
    vi.useFakeTimers();
    // Oct 15, 2025 (mid-season)
    vi.setSystemTime(new Date("2025-10-15T12:00:00-04:00"));
    const result = getCurrentNFLWeek();
    expect(result.seasonState).toBe(SeasonState.IN_SEASON);
    expect(result.isOffseason).toBe(false);
    expect(result.season).toBe(2025);
    expect(result.week).toBeGreaterThanOrEqual(1);
    expect(result.week).toBeLessThanOrEqual(18);
  });

  it("returns PRE_SEASON before Sept 4, 2025", () => {
    vi.useFakeTimers();
    // Aug 15, 2025 — between 2024 season end and 2025 season start
    vi.setSystemTime(new Date("2025-08-15T12:00:00-04:00"));
    const result = getCurrentNFLWeek();
    expect(result.seasonState).toBe(SeasonState.PRE_SEASON);
    expect(result.isOffseason).toBe(true);
    expect(result.season).toBe(2025);
  });

  it("returns POSTSEASON in Jan-Feb after season ends", () => {
    vi.useFakeTimers();
    // Feb 1, 2026 — after 2025 season ended, playoffs window
    vi.setSystemTime(new Date("2026-02-01T12:00:00-05:00"));
    const result = getCurrentNFLWeek();
    expect(result.seasonState).toBe(SeasonState.POSTSEASON);
    expect(result.isOffseason).toBe(true);
    expect(result.season).toBe(2025);
  });

  it("returns PRE_SEASON in Mar-Aug between seasons", () => {
    vi.useFakeTimers();
    // May 1, 2026 — offseason gap, pre-season for 2026
    vi.setSystemTime(new Date("2026-05-01T12:00:00-04:00"));
    const result = getCurrentNFLWeek();
    expect(result.seasonState).toBe(SeasonState.PRE_SEASON);
    expect(result.isOffseason).toBe(true);
    expect(result.season).toBe(2026);
  });

  it("returns week 1 at season start", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-09-04T12:00:00-04:00"));
    const result = getCurrentNFLWeek();
    expect(result.week).toBe(1);
    expect(result.seasonState).toBe(SeasonState.IN_SEASON);
  });

  it("caps week at 18", () => {
    vi.useFakeTimers();
    // Jan 5, 2026 — near end of season
    vi.setSystemTime(new Date("2026-01-05T12:00:00-05:00"));
    const result = getCurrentNFLWeek();
    expect(result.week).toBeLessThanOrEqual(18);
  });

  it("advances week on Tuesday after 3 AM", () => {
    vi.useFakeTimers();
    // Tue Oct 7, 2025 at 4 AM ET (after MNF rollover)
    vi.setSystemTime(new Date("2025-10-07T04:00:00-04:00"));
    const result1 = getCurrentNFLWeek();

    // Mon Oct 6, 2025 at 10 PM ET (before rollover)
    vi.setSystemTime(new Date("2025-10-06T22:00:00-04:00"));
    const result2 = getCurrentNFLWeek();

    // Tuesday result should be 1 week ahead of Monday
    expect(result1.week).toBe(result2.week + 1);
  });
});

describe("formatLastUpdated", () => {
  it("returns 'Just now' for recent timestamps", () => {
    expect(formatLastUpdated(new Date())).toBe("Just now");
  });

  it("returns minutes for recent timestamps", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatLastUpdated(fiveMinAgo)).toBe("5m ago");
  });

  it("returns hours for older timestamps", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    expect(formatLastUpdated(twoHoursAgo)).toBe("2h ago");
  });

  it("returns days for timestamps within a week", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400 * 1000);
    expect(formatLastUpdated(threeDaysAgo)).toBe("3d ago");
  });

  it("accepts string dates", () => {
    const result = formatLastUpdated(new Date().toISOString());
    expect(result).toBe("Just now");
  });
});
