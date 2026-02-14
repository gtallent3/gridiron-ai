import { describe, it, expect } from "vitest";
import {
  calculateFantasyPoints,
  DEFAULT_PPR_SCORING,
  DEFAULT_STANDARD_SCORING,
  DEFAULT_HALF_PPR_SCORING,
  getScoringSettings,
} from "./fantasyPointsCalculator";

describe("calculateFantasyPoints", () => {
  it("calculates QB points correctly (PPR)", () => {
    const stats = {
      passing_yards: 300,
      passing_tds: 3,
      interceptions: 1,
      rushing_yards: 20,
    };
    const result = calculateFantasyPoints(stats, DEFAULT_PPR_SCORING);
    // 300*0.04 + 3*4 + 1*(-2) + 20*0.1 = 12 + 12 - 2 + 2 = 24
    expect(result.total).toBe(24);
  });

  it("calculates RB points correctly (PPR)", () => {
    const stats = {
      rushing_yards: 100,
      rushing_tds: 1,
      receptions: 4,
      receiving_yards: 30,
    };
    const result = calculateFantasyPoints(stats, DEFAULT_PPR_SCORING);
    // 100*0.1 + 1*6 + 4*1 + 30*0.1 = 10 + 6 + 4 + 3 = 23
    expect(result.total).toBe(23);
  });

  it("gives zero for receptions in standard scoring", () => {
    const stats = { receptions: 5, receiving_yards: 50 };
    const result = calculateFantasyPoints(stats, DEFAULT_STANDARD_SCORING);
    // 5*0 + 50*0.1 = 5
    expect(result.total).toBe(5);
  });

  it("gives half point per reception in half PPR", () => {
    const stats = { receptions: 6 };
    const result = calculateFantasyPoints(stats, DEFAULT_HALF_PPR_SCORING);
    // 6 * 0.5 = 3
    expect(result.total).toBe(3);
  });

  it("handles fumbles lost correctly", () => {
    const stats = { rushing_yards: 50, fumbles_lost: 1 };
    const result = calculateFantasyPoints(stats, DEFAULT_PPR_SCORING);
    // 50*0.1 + 1*(-2) = 5 - 2 = 3
    expect(result.total).toBe(3);
  });

  it("handles kicker points", () => {
    const stats = { fg_made_40_49: 2, fg_made_50_plus: 1, xp_made: 3 };
    const result = calculateFantasyPoints(stats, DEFAULT_PPR_SCORING);
    // 2*4 + 1*5 + 3*1 = 8 + 5 + 3 = 16
    expect(result.total).toBe(16);
  });

  it("handles DST points allowed tiers", () => {
    const stats = { sacks: 3, points_allowed: 10 };
    const result = calculateFantasyPoints(stats, DEFAULT_PPR_SCORING);
    // sacks: 3*1 = 3, points_allowed 7-13 tier = 4 -> total = 7
    expect(result.total).toBe(7);
  });

  it("returns breakdown object", () => {
    const stats = { passing_yards: 200, passing_tds: 2 };
    const result = calculateFantasyPoints(stats, DEFAULT_PPR_SCORING);
    expect(result.breakdown.passing_yards).toBe(8); // 200 * 0.04
    expect(result.breakdown.passing_tds).toBe(8); // 2 * 4
    expect(result.total).toBe(16);
  });

  it("returns zero for empty stats", () => {
    const result = calculateFantasyPoints({});
    expect(result.total).toBe(0);
    expect(Object.keys(result.breakdown).length).toBe(0);
  });
});

describe("getScoringSettings", () => {
  it("returns PPR settings", () => {
    const settings = getScoringSettings("ppr");
    expect(settings.receptions).toBe(1);
  });

  it("returns standard settings", () => {
    const settings = getScoringSettings("standard");
    expect(settings.receptions).toBe(0);
  });

  it("returns half PPR settings", () => {
    const settings = getScoringSettings("half_ppr");
    expect(settings.receptions).toBe(0.5);
  });

  it("merges custom settings", () => {
    const settings = getScoringSettings("ppr", { passing_tds: 6 });
    expect(settings.passing_tds).toBe(6);
    expect(settings.receptions).toBe(1);
  });
});
