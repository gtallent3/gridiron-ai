import { describe, it, expect } from "vitest";
import { isTeamOnBye, getTeamByeWeek, byeWeekSchedule2025 } from "./byeWeekSchedule";

describe("isTeamOnBye", () => {
  it("returns true when team is on bye", () => {
    expect(isTeamOnBye("ATL", 5)).toBe(true);
    expect(isTeamOnBye("KC", 10)).toBe(true);
    expect(isTeamOnBye("SF", 14)).toBe(true);
  });

  it("returns false when team is not on bye", () => {
    expect(isTeamOnBye("ATL", 6)).toBe(false);
    expect(isTeamOnBye("KC", 5)).toBe(false);
  });

  it("returns false for null/undefined team", () => {
    expect(isTeamOnBye(null, 5)).toBe(false);
    expect(isTeamOnBye(undefined, 5)).toBe(false);
    expect(isTeamOnBye("", 5)).toBe(false);
  });
});

describe("getTeamByeWeek", () => {
  it("returns the correct bye week", () => {
    expect(getTeamByeWeek("CHI")).toBe(5);
    expect(getTeamByeWeek("MIA")).toBe(12);
    expect(getTeamByeWeek("NE")).toBe(14);
  });

  it("returns null for unknown team", () => {
    expect(getTeamByeWeek("XXX")).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(getTeamByeWeek(null)).toBeNull();
    expect(getTeamByeWeek(undefined)).toBeNull();
  });
});

describe("byeWeekSchedule2025", () => {
  it("has all 32 NFL teams", () => {
    expect(byeWeekSchedule2025.size).toBe(32);
  });

  it("bye weeks are between 5 and 14", () => {
    for (const [, week] of byeWeekSchedule2025) {
      expect(week).toBeGreaterThanOrEqual(5);
      expect(week).toBeLessThanOrEqual(14);
    }
  });
});
