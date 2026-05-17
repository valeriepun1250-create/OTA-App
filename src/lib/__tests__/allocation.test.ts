import { describe, expect, it } from "vitest";
import {
  TEAM_WEIGHTS,
  TOTAL_WEIGHT,
  computePoolAllocation,
  parseWard,
  compareWardProximity,
  assistantWardTier,
  rankAssistantsForWard,
  hamiltonAllocate,
  splitTargetAcrossPools,
  autoDistributeS2S5,
  computeScore,
  dispatchTasksByLocation,
  rebalanceAllocations,
  LocationTier,
  type AutoDistAssistant,
} from "../allocation";

// ─────────────────────────────────────────────
// parseWard
// ─────────────────────────────────────────────
describe("parseWard", () => {
  it("parses floor + room + cluster", () => {
    expect(parseWard("3A")).toEqual({ raw: "3A", floor: 3, room: "A", cluster: "CLUSTER_1" });
    expect(parseWard("12E")).toEqual({ raw: "12E", floor: 12, room: "E", cluster: "CLUSTER_2" });
  });

  it("accepts lowercase and uppercases", () => {
    expect(parseWard("3a").room).toBe("A");
  });

  it("Cluster 1 = A-D, Cluster 2 = E-H", () => {
    expect(parseWard("5D").cluster).toBe("CLUSTER_1");
    expect(parseWard("5E").cluster).toBe("CLUSTER_2");
    expect(parseWard("5H").cluster).toBe("CLUSTER_2");
  });

  it("throws on invalid input", () => {
    expect(() => parseWard("ABC")).toThrow();
    expect(() => parseWard("3X")).toThrow();   // X not in any cluster
    expect(() => parseWard("")).toThrow();
  });
});

// ─────────────────────────────────────────────
// compareWardProximity — three tiers + cross-cluster
// ─────────────────────────────────────────────
describe("compareWardProximity four tiers", () => {
  it("Tier 1: same floor same cluster", () => {
    expect(compareWardProximity(parseWard("3A"), parseWard("3B"))).toBe(LocationTier.SAME_FLOOR_SAME_CLUSTER);
    expect(compareWardProximity(parseWard("3A"), parseWard("3A"))).toBe(LocationTier.SAME_FLOOR_SAME_CLUSTER);
  });

  it("Tier 2: vertical adjacent (same room different floor)", () => {
    expect(compareWardProximity(parseWard("3A"), parseWard("4A"))).toBe(LocationTier.VERTICAL_SAME_ROOM);
    expect(compareWardProximity(parseWard("8E"), parseWard("12E"))).toBe(LocationTier.VERTICAL_SAME_ROOM);
  });

  it("Tier 3: same cluster different floor different room", () => {
    expect(compareWardProximity(parseWard("3A"), parseWard("4D"))).toBe(LocationTier.SAME_CLUSTER);
  });

  it("Tier 4: cross cluster", () => {
    expect(compareWardProximity(parseWard("3A"), parseWard("3E"))).toBe(LocationTier.CROSS_CLUSTER);
    expect(compareWardProximity(parseWard("3A"), parseWard("12H"))).toBe(LocationTier.CROSS_CLUSTER);
  });
});

// ─────────────────────────────────────────────
// assistantWardTier — best tier
// ─────────────────────────────────────────────
describe("assistantWardTier", () => {
  it("returns CROSS_CLUSTER (neutral) when no existing tasks", () => {
    expect(assistantWardTier([], "3A")).toBe(LocationTier.CROSS_CLUSTER);
  });

  it("returns best tier among all existing tasks", () => {
    // Assistant at 5E (cross), 4A (vertical). New task 3A → should get vertical = 2
    expect(assistantWardTier(["5E", "4A"], "3A")).toBe(LocationTier.VERTICAL_SAME_ROOM);
  });

  it("same floor same cluster is best when available", () => {
    expect(assistantWardTier(["3A", "5H"], "3B")).toBe(LocationTier.SAME_FLOOR_SAME_CLUSTER);
  });
});

// ─────────────────────────────────────────────
// rankAssistantsForWard — sorting rules
// ─────────────────────────────────────────────
describe("rankAssistantsForWard", () => {
  it("lower tier comes first", () => {
    const result = rankAssistantsForWard(
      [
        { assistantId: "x", existingWards: ["5E"], totalScore: 0 },        // CROSS
        { assistantId: "y", existingWards: ["3B"], totalScore: 0 },        // SAME_FLOOR
        { assistantId: "z", existingWards: ["4A"], totalScore: 0 },        // VERTICAL
      ],
      "3A"
    );
    expect(result.map((r) => r.assistantId)).toEqual(["y", "z", "x"]);
  });

  it("within same tier, lower totalScore first (load balancing)", () => {
    const result = rankAssistantsForWard(
      [
        { assistantId: "high", existingWards: ["3B"], totalScore: 10 },
        { assistantId: "low",  existingWards: ["3C"], totalScore: 1 },
      ],
      "3A"
    );
    expect(result[0].assistantId).toBe("low");
  });

  it("busy always at the end", () => {
    const result = rankAssistantsForWard(
      [
        { assistantId: "busy", existingWards: ["3B"], totalScore: 0, isBusy: true },
        { assistantId: "free", existingWards: ["5E"], totalScore: 99 },
      ],
      "3A"
    );
    expect(result[0].assistantId).toBe("free");
    expect(result[1].assistantId).toBe("busy");
    expect(result[1].isBusy).toBe(true);
  });

  it("crossClusterWarning flag is correct", () => {
    const result = rankAssistantsForWard(
      [{ assistantId: "x", existingWards: ["5E"], totalScore: 0 }],
      "3A"
    );
    expect(result[0].crossClusterWarning).toBe(true);
  });
});

// ─────────────────────────────────────────────
// computePoolAllocation — §2.2 quota formula
// ─────────────────────────────────────────────
describe("computePoolAllocation", () => {
  it("total weight should be 15.5", () => {
    expect(TOTAL_WEIGHT).toBeCloseTo(15.5);
  });

  it("0 assistants = all zero", () => {
    const result = computePoolAllocation("AM", { assistantsOnDuty: 0 });
    for (const r of result) expect(r.rawQuota).toBe(0);
  });

  it("5 assistants AM pool (10 slots), correct ratio", () => {
    const result = computePoolAllocation("AM", { assistantsOnDuty: 5 });
    const ns = result.find((r) => r.team === "NS")!;
    const stroke = result.find((r) => r.team === "STROKE")!;
    // NS weight 3.5/15.5 × 10 = 2.258
    expect(ns.rawQuota).toBeCloseTo(10 * 3.5 / 15.5, 4);
    expect(stroke.rawQuota).toBeCloseTo(10 * 4 / 15.5, 4);
  });
});

// ─────────────────────────────────────────────
// hamiltonAllocate — largest remainder method
// ─────────────────────────────────────────────
describe("hamiltonAllocate", () => {
  it("sum = totalSlots (integer sum conservation)", () => {
    const r = hamiltonAllocate(20, TEAM_WEIGHTS);
    const sum = Object.values(r).reduce((a, b) => a + b, 0);
    expect(sum).toBe(20);
  });

  it("sum conservation for any N ∈ [0, 100]", () => {
    for (let n = 0; n <= 100; n++) {
      const r = hamiltonAllocate(n, TEAM_WEIGHTS);
      const sum = Object.values(r).reduce((a, b) => a + b, 0);
      expect(sum).toBe(n);
    }
  });

  it("totalSlots = 0 → all zero", () => {
    const r = hamiltonAllocate(0, TEAM_WEIGHTS);
    expect(Object.values(r).every((v) => v === 0)).toBe(true);
  });

  it("known case: 20 slots, weights 3.5:4:2:4:2 → NS=4, Stroke=5, Surgical=3, Ortho=5, Peds=3", () => {
    const r = hamiltonAllocate(20, TEAM_WEIGHTS);
    expect(r).toEqual({ NS: 4, STROKE: 5, SURGICAL: 3, ORTHO: 5, PEDS: 3 });
  });

  it("known case: 10 slots → NS=2, Stroke=3, Surgical=1, Ortho=3, Peds=1", () => {
    const r = hamiltonAllocate(10, TEAM_WEIGHTS);
    expect(r).toEqual({ NS: 2, STROKE: 3, SURGICAL: 1, ORTHO: 3, PEDS: 1 });
  });

  it("equal weights → even distribution", () => {
    const equal = { NS: 1, STROKE: 1, SURGICAL: 1, ORTHO: 1, PEDS: 1 };
    const r = hamiltonAllocate(10, equal);
    expect(Object.values(r)).toEqual([2, 2, 2, 2, 2]);
  });

  it("never returns negative", () => {
    const r = hamiltonAllocate(7, TEAM_WEIGHTS);
    for (const v of Object.values(r)) expect(v).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────
// splitTargetAcrossPools — split full-day target into AM/PM
// ─────────────────────────────────────────────
describe("splitTargetAcrossPools", () => {
  const target = { NS: 4, STROKE: 5, SURGICAL: 3, ORTHO: 5, PEDS: 3 };

  it("AM/PM equal capacity (10/10) → symmetric split, sum conserved", () => {
    const { am, pm } = splitTargetAcrossPools(target, 10, 10);
    expect(Object.values(am).reduce((a, b) => a + b, 0)).toBe(10);
    expect(Object.values(pm).reduce((a, b) => a + b, 0)).toBe(10);
    for (const t of ["NS", "STROKE", "SURGICAL", "ORTHO", "PEDS"] as const) {
      expect(am[t] + pm[t]).toBe(target[t]);
    }
  });

  it("when AM capacity is larger, slots should lean AM", () => {
    const { am, pm } = splitTargetAcrossPools(target, 16, 4);
    expect(Object.values(am).reduce((a, b) => a + b, 0)).toBe(16);
    expect(Object.values(pm).reduce((a, b) => a + b, 0)).toBe(4);
  });

  it("total 0 → all zero", () => {
    const { am, pm } = splitTargetAcrossPools(target, 0, 0);
    expect(Object.values(am).every((v) => v === 0)).toBe(true);
    expect(Object.values(pm).every((v) => v === 0)).toBe(true);
  });

  it("split am[t], pm[t] are all ≥ 0", () => {
    const { am, pm } = splitTargetAcrossPools(target, 7, 13);
    for (const t of ["NS", "STROKE", "SURGICAL", "ORTHO", "PEDS"] as const) {
      expect(am[t]).toBeGreaterThanOrEqual(0);
      expect(pm[t]).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─────────────────────────────────────────────
// autoDistributeS2S5 — S2-S5 auto-distribution
// ─────────────────────────────────────────────
describe("autoDistributeS2S5", () => {
  function mkAssistant(
    id: string,
    overrides: Partial<AutoDistAssistant> = {}
  ): AutoDistAssistant {
    return {
      id,
      homeTeam: null,
      s1Wards: [],
      onDutyAM: true,
      onDutyPM: true,
      ...overrides,
    };
  }

  it("empty assistant list → empty output", () => {
    expect(autoDistributeS2S5({ assistants: [] })).toEqual([]);
  });

  it("only 1 assistant full-time → all 4 slots go to that assistant", () => {
    const result = autoDistributeS2S5({
      assistants: [mkAssistant("a1", { homeTeam: "NS" })],
    });
    expect(result).toHaveLength(4);
    const slots = result.map((r) => r.slot).sort();
    expect(slots).toEqual(["S2", "S3", "S4", "S5"]);
    expect(result.every((r) => r.assistantId === "a1")).toBe(true);
  });

  it("5 assistants full-time → 20 slots, each team quota matches Hamilton", () => {
    const assistants = [
      mkAssistant("a1", { homeTeam: "NS" }),
      mkAssistant("a2", { homeTeam: "STROKE" }),
      mkAssistant("a3", { homeTeam: "ORTHO" }),
      mkAssistant("a4", { homeTeam: "PEDS" }),
      mkAssistant("a5", { homeTeam: "SURGICAL" }),
    ];
    const result = autoDistributeS2S5({ assistants });
    expect(result).toHaveLength(20);

    // Count per-team slots
    const perTeam: Record<string, number> = {};
    for (const r of result) perTeam[r.team] = (perTeam[r.team] ?? 0) + 1;

    // Hamilton expectation: NS=4, Stroke=5, Surgical=3, Ortho=5, Peds=3
    expect(perTeam.NS).toBe(4);
    expect(perTeam.STROKE).toBe(5);
    expect(perTeam.SURGICAL).toBe(3);
    expect(perTeam.ORTHO).toBe(5);
    expect(perTeam.PEDS).toBe(3);
  });

  it("AM_ONLY (onDutyPM=false) only gets S2/S3", () => {
    const result = autoDistributeS2S5({
      assistants: [mkAssistant("am_only", { onDutyPM: false, homeTeam: "NS" })],
    });
    const slots = result.map((r) => r.slot);
    expect(slots).toContain("S2");
    expect(slots).toContain("S3");
    expect(slots).not.toContain("S4");
    expect(slots).not.toContain("S5");
  });

  it("PM_ONLY (onDutyAM=false) only gets S4/S5", () => {
    const result = autoDistributeS2S5({
      assistants: [mkAssistant("pm_only", { onDutyAM: false, homeTeam: "NS" })],
    });
    const slots = result.map((r) => r.slot);
    expect(slots).toEqual(expect.arrayContaining(["S4", "S5"]));
    expect(slots).not.toContain("S2");
  });

  it("AM pool total slots = 2 × AM on duty; PM pool similarly", () => {
    const result = autoDistributeS2S5({
      assistants: [
        mkAssistant("a1"),                                 // full-time
        mkAssistant("a2", { onDutyPM: false }),            // AM only
        mkAssistant("a3", { onDutyAM: false }),            // PM only
      ],
    });
    const am = result.filter((r) => r.slot === "S2" || r.slot === "S3");
    const pm = result.filter((r) => r.slot === "S4" || r.slot === "S5");
    expect(am).toHaveLength(2 * 2); // 2 AM on duty × 2 slots
    expect(pm).toHaveLength(2 * 2); // 2 PM on duty × 2 slots
  });

  it("continuity: assistant AM and PM should be same team when possible", () => {
    // 5 assistants × 2 pools, expect most assistants AM team == PM team
    const assistants = [
      mkAssistant("a1", { homeTeam: "NS" }),
      mkAssistant("a2", { homeTeam: "STROKE" }),
      mkAssistant("a3", { homeTeam: "ORTHO" }),
      mkAssistant("a4", { homeTeam: "PEDS" }),
      mkAssistant("a5", { homeTeam: "SURGICAL" }),
    ];
    const result = autoDistributeS2S5({ assistants });

    const amTeam: Record<string, string> = {};
    const pmTeam: Record<string, string> = {};
    for (const r of result) {
      if (r.slot === "S2") amTeam[r.assistantId] = r.team;
      if (r.slot === "S4") pmTeam[r.assistantId] = r.team;
    }
    // At least 60% of assistants have same AM/PM team
    const continuous = assistants.filter((a) => amTeam[a.id] === pmTeam[a.id]).length;
    expect(continuous).toBeGreaterThanOrEqual(3);
  });

  it("geographic preference: CLUSTER_2 S1 assistant guided to CLUSTER_2 team (Surgical/Ortho)", () => {
    // 5 assistants (10 AM slots), Hamilton gives ORTHO 3 slots ≥2, cluster preference satisfies whole block
    const result = autoDistributeS2S5({
      assistants: [
        mkAssistant("c2_lover", { homeTeam: null, s1Wards: ["5E", "5F", "8E"] }),
        mkAssistant("a2", { homeTeam: null }),
        mkAssistant("a3", { homeTeam: null }),
        mkAssistant("a4", { homeTeam: null }),
        mkAssistant("a5", { homeTeam: null }),
      ],
    });
    // c2_lover should be assigned to CLUSTER_2 team (SURGICAL/ORTHO)
    const s2Team = result.find((r) => r.assistantId === "c2_lover" && r.slot === "S2")?.team;
    expect(["SURGICAL", "ORTHO"]).toContain(s2Team);
  });

  it("geographic preference: CLUSTER_1 S1 assistant guided to CLUSTER_1 team (NS/Stroke/Peds)", () => {
    const result = autoDistributeS2S5({
      assistants: [
        mkAssistant("c1_lover", { homeTeam: null, s1Wards: ["3A", "3B", "4C"] }),
        mkAssistant("a2", { homeTeam: null }),
        mkAssistant("a3", { homeTeam: null }),
        mkAssistant("a4", { homeTeam: null }),
        mkAssistant("a5", { homeTeam: null }),
      ],
    });
    const s2Team = result.find((r) => r.assistantId === "c1_lover" && r.slot === "S2")?.team;
    expect(["NS", "STROKE", "PEDS"]).toContain(s2Team);
  });

  it("split: when remainder leaves a team with only 1 slot, correctly splits block", () => {
    // 3 assistants × AM 2 slots = 6 slots
    // 6 slot allocation: NS=6×3.5/15.5=1.35, Stroke=1.55, Surgical=0.77, Ortho=1.55, Peds=0.77
    // Hamilton: floors=1+1+0+1+0=3, remainder 3 to largest → NS(0.35), Stroke(0.55), Surgical(0.77), Ortho(0.55), Peds(0.77)
    // top 3 remainders: Surgical(0.77), Peds(0.77), Stroke(0.55) → +1 each
    // Final: NS=1, Stroke=2, Surgical=1, Ortho=1, Peds=1, total=6 ✓
    const result = autoDistributeS2S5({
      assistants: [
        mkAssistant("a1", { homeTeam: "STROKE" }),
        mkAssistant("a2", { homeTeam: "STROKE" }),
        mkAssistant("a3", { homeTeam: "STROKE" }),
      ],
    });
    const am = result.filter((r) => r.slot === "S2" || r.slot === "S3");
    expect(am).toHaveLength(6);

    const perTeamAM: Record<string, number> = {};
    for (const r of am) perTeamAM[r.team] = (perTeamAM[r.team] ?? 0) + 1;

    // Integer sum should = 6
    const sum = Object.values(perTeamAM).reduce((a, b) => a + b, 0);
    expect(sum).toBe(6);

    // At least 2 different teams — proves actual splitting occurred
    expect(Object.keys(perTeamAM).length).toBeGreaterThanOrEqual(2);
  });

  it("no duplicates in result (assistantId, slot)", () => {
    const result = autoDistributeS2S5({
      assistants: Array.from({ length: 8 }, (_, i) =>
        mkAssistant(`a${i}`, { homeTeam: "NS" })
      ),
    });
    const seen = new Set<string>();
    for (const r of result) {
      const key = `${r.assistantId}-${r.slot}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("result slots are only S2-S5 (never accidentally S1)", () => {
    const result = autoDistributeS2S5({
      assistants: Array.from({ length: 5 }, (_, i) => mkAssistant(`a${i}`)),
    });
    for (const r of result) {
      expect(["S2", "S3", "S4", "S5"]).toContain(r.slot);
    }
  });

  it("after rebalance: each pool per-team deviation < 1 (||actual − target|| < 1)", () => {
    // Run verification on multiple random sizes
    for (const N of [3, 5, 7, 10]) {
      const result = autoDistributeS2S5({
        assistants: Array.from({ length: N }, (_, i) =>
          mkAssistant(`a${i}`, {
            homeTeam: (["NS", "STROKE", "SURGICAL", "ORTHO", "PEDS"] as const)[i % 5],
          })
        ),
      });

      // Expected target = totalSlots × weight[t] / Σ weights
      const totalAM = N * 2;
      const totalPM = N * 2;
      const w = { NS: 3.5, STROKE: 4, SURGICAL: 2, ORTHO: 4, PEDS: 2 };
      const total = 15.5;

      const countByPoolTeam: Record<string, Record<string, number>> = {
        AM: {}, PM: {}
      };
      for (const r of result) {
        const pool = r.slot === "S2" || r.slot === "S3" ? "AM" : "PM";
        countByPoolTeam[pool][r.team] = (countByPoolTeam[pool][r.team] ?? 0) + 1;
      }

      for (const t of ["NS", "STROKE", "SURGICAL", "ORTHO", "PEDS"] as const) {
        const amTarget = (totalAM * w[t]) / total;
        const pmTarget = (totalPM * w[t]) / total;
        const amDiff = Math.abs((countByPoolTeam.AM[t] ?? 0) - amTarget);
        const pmDiff = Math.abs((countByPoolTeam.PM[t] ?? 0) - pmTarget);
        expect(amDiff).toBeLessThan(1);
        expect(pmDiff).toBeLessThan(1);
      }
    }
  });
});

// ─────────────────────────────────────────────
// rebalanceAllocations — test post-processing in isolation
// ─────────────────────────────────────────────
describe("rebalanceAllocations", () => {
  it("already balanced input → no changes", () => {
    const input = [
      { assistantId: "a1", slot: "S2" as const, team: "NS" as const },
      { assistantId: "a1", slot: "S3" as const, team: "NS" as const },
    ];
    const result = rebalanceAllocations(
      input,
      { NS: 2, STROKE: 0, SURGICAL: 0, ORTHO: 0, PEDS: 0 },
      { NS: 0, STROKE: 0, SURGICAL: 0, ORTHO: 0, PEDS: 0 },
    );
    expect(result).toEqual(input);
  });

  it("OVER +2 / UNDER -2 → balanced to difference 0", () => {
    // Construct deliberately imbalanced: NS gets 4 AM slots (target 2), STROKE gets 0 (target 2)
    const input = [
      { assistantId: "a1", slot: "S2" as const, team: "NS" as const },
      { assistantId: "a1", slot: "S3" as const, team: "NS" as const },
      { assistantId: "a2", slot: "S2" as const, team: "NS" as const },
      { assistantId: "a2", slot: "S3" as const, team: "NS" as const },
    ];
    const result = rebalanceAllocations(
      input,
      { NS: 2, STROKE: 2, SURGICAL: 0, ORTHO: 0, PEDS: 0 },
      { NS: 0, STROKE: 0, SURGICAL: 0, ORTHO: 0, PEDS: 0 },
    );
    const counts: Record<string, number> = {};
    for (const r of result) counts[r.team] = (counts[r.team] ?? 0) + 1;
    expect(counts.NS).toBe(2);
    expect(counts.STROKE).toBe(2);
  });

  it("total slot count conserved", () => {
    const input = [
      { assistantId: "a1", slot: "S2" as const, team: "NS" as const },
      { assistantId: "a1", slot: "S3" as const, team: "NS" as const },
      { assistantId: "a2", slot: "S2" as const, team: "NS" as const },
    ];
    const result = rebalanceAllocations(
      input,
      { NS: 1, STROKE: 1, SURGICAL: 1, ORTHO: 0, PEDS: 0 },
      { NS: 0, STROKE: 0, SURGICAL: 0, ORTHO: 0, PEDS: 0 },
    );
    expect(result).toHaveLength(input.length);
  });

  it("does not break (assistantId, slot) uniqueness", () => {
    const input = [
      { assistantId: "a1", slot: "S2" as const, team: "NS" as const },
      { assistantId: "a1", slot: "S3" as const, team: "NS" as const },
      { assistantId: "a2", slot: "S2" as const, team: "NS" as const },
      { assistantId: "a2", slot: "S3" as const, team: "NS" as const },
    ];
    const result = rebalanceAllocations(
      input,
      { NS: 2, STROKE: 1, SURGICAL: 1, ORTHO: 0, PEDS: 0 },
      { NS: 0, STROKE: 0, SURGICAL: 0, ORTHO: 0, PEDS: 0 },
    );
    const seen = new Set<string>();
    for (const r of result) {
      const key = `${r.assistantId}-${r.slot}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

// ─────────────────────────────────────────────
// computeScore — S1 task scoring
// ─────────────────────────────────────────────
describe("computeScore", () => {
  it("Content containing MoCA = 2 pts", () => {
    expect(computeScore("MoCA")).toBe(2);
    expect(computeScore("MoCA 認知評估")).toBe(2);
    expect(computeScore("認知評估 (MoCA)")).toBe(2);
  });

  it("case insensitive", () => {
    expect(computeScore("moca")).toBe(2);
    expect(computeScore("MOCA")).toBe(2);
    expect(computeScore("Moca")).toBe(2);
  });

  it("other tasks = 1 pt", () => {
    expect(computeScore("AMT")).toBe(1);
    expect(computeScore("Fit/Check (TED)")).toBe(1);
    expect(computeScore("AMT + CDT")).toBe(1);
  });

  it("null/empty = 1 pt", () => {
    expect(computeScore(null)).toBe(1);
    expect(computeScore(undefined)).toBe(1);
    expect(computeScore("")).toBe(1);
  });
});

// ─────────────────────────────────────────────
// dispatchTasksByLocation — S1 batch task dispatch
// ─────────────────────────────────────────────
describe("dispatchTasksByLocation", () => {
  it("no assistants → empty output", () => {
    expect(dispatchTasksByLocation([{ id: "t1", ward: "3A", score: 1 }], [])).toEqual([]);
  });

  it("no tasks → empty output", () => {
    expect(dispatchTasksByLocation([], [{ id: "a1", currentWards: [], currentScore: 0 }])).toEqual([]);
  });

  it("all tasks should be dispatched", () => {
    const result = dispatchTasksByLocation(
      [
        { id: "t1", ward: "3A", score: 1 },
        { id: "t2", ward: "4D", score: 2 },
        { id: "t3", ward: "5E", score: 1 },
      ],
      [
        { id: "a1", currentWards: [], currentScore: 0 },
        { id: "a2", currentWards: [], currentScore: 0 },
      ]
    );
    expect(result).toHaveLength(3);
    expect(new Set(result.map((r) => r.taskId))).toEqual(new Set(["t1", "t2", "t3"]));
  });

  it("same cluster task assigned to assistant already in that cluster", () => {
    const result = dispatchTasksByLocation(
      [{ id: "t1", ward: "3A", score: 1 }],
      [
        { id: "cluster1", currentWards: ["3B"], currentScore: 0 },
        { id: "cluster2", currentWards: ["5E"], currentScore: 0 },
      ]
    );
    expect(result[0].assistantId).toBe("cluster1");
  });

  it("load balancing: same tier, lower score assistant gets priority", () => {
    const result = dispatchTasksByLocation(
      [{ id: "t1", ward: "3A", score: 1 }],
      [
        { id: "busy", currentWards: [], currentScore: 5 },
        { id: "free", currentWards: [], currentScore: 0 },
      ]
    );
    expect(result[0].assistantId).toBe("free");
  });

  it("high-score tasks dispatched first → same tier scores are balanced (different wards)", () => {
    // 4 tasks in 4 different cluster 1 wards; 2 assistants with no existing tasks → all CROSS_CLUSTER tier
    // High score first: MoCA(2) → a1, AMT(1) → a2, AMT(1) → a2 (a2 now=1, a1=2, but next task a2 still lower tier)
    // ...Actually: MoCA first → a1 (=2); then AMT checks if a1 still same tier
    // a1 now has ["3A"], subsequent tasks in 3B (same cluster same floor) → a1 tier 1, a2 tier 4 → still a1
    // Design: subsequent tasks in different clusters to keep tiers equal
    const result = dispatchTasksByLocation(
      [
        { id: "moca", ward: "3A", score: 2 },
        { id: "amt1", ward: "8E", score: 1 },
        { id: "amt2", ward: "8F", score: 1 },
      ],
      [
        { id: "a1", currentWards: [], currentScore: 0 },
        { id: "a2", currentWards: [], currentScore: 0 },
      ]
    );
    // Count total score per assistant
    const totals: Record<string, number> = { a1: 0, a2: 0 };
    const scoreOf: Record<string, number> = { moca: 2, amt1: 1, amt2: 1 };
    for (const r of result) totals[r.assistantId] += scoreOf[r.taskId];
    // Expected: MoCA dispatched to a1 first (score=2), then 8E and 8F both cross cluster
    //  - 8E: a1 at 3A (CROSS), a2 empty (CROSS) → same tier, a2 score lower → a2 (=1)
    //  - 8F: a1 at 3A (CROSS), a2 at 8E (same floor same cluster=1) → a2 tier1 wins
    //  Final a1=2, a2=2 ✓
    expect(Math.abs(totals.a1 - totals.a2)).toBeLessThanOrEqual(1);
  });

  it("unparseable ward does not interrupt dispatch", () => {
    const result = dispatchTasksByLocation(
      [
        { id: "t1", ward: "INVALID", score: 1 },
        { id: "t2", ward: "3A", score: 1 },
      ],
      [{ id: "a1", currentWards: [], currentScore: 0 }]
    );
    expect(result).toHaveLength(2);
  });
});
