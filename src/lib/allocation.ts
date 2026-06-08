// §2.2 Assistant slot allocation logic
// Formula: Team slot count = (Team therapist weight / Total therapist weight) × (Assistants on duty × Slots per assistant)
// AM = S2 + S3 (2 slots each), PM = S4 + S5 (2 slots each)

// Type-only imports — allocation.ts avoids importing @prisma/client runtime values for easier unit testing
import { S1_SPECIALTY_TEAM, type S1Specialty } from "@/types/db-enums";
import type { TeamCode, SessionPool, WardCluster, SlotCode } from "@/types/db-enums";

export const TEAM_WEIGHTS: Record<TeamCode, number> = {
  NS: 3.5,
  STROKE: 4,
  SURGICAL: 2,
  ORTHO: 4,
  PEDS: 2,
};

export const TOTAL_WEIGHT = Object.values(TEAM_WEIGHTS).reduce((a, b) => a + b, 0); // 15.5

export const SLOTS_PER_POOL = 2; // AM: S2+S3, PM: S4+S5

export interface PoolAllocationInput {
  /** Number of assistants on duty for this pool (AM or PM) */
  assistantsOnDuty: number;
  /** Each team's therapist weight, defaults to TEAM_WEIGHTS */
  weights?: Record<TeamCode, number>;
}

export interface TeamPoolQuota {
  team: TeamCode;
  pool: SessionPool;
  /** Raw float value (fair ratio) */
  rawQuota: number;
  /** Rounded/floor'd assignable slots (reserved — adjust based on hospital rules) */
  quota: number;
}

/**
 * Calculate assignable assistant slots per team for a single pool (AM or PM)
 *
 * @example
 *   // AM with 6 assistants on duty → total assignable slots = 6 × 2 = 12
 *   // NS team quota = (3.5 / 15.5) × 12 ≈ 2.71
 *   computePoolAllocation('AM', { assistantsOnDuty: 6 })
 */
export function computePoolAllocation(
  pool: SessionPool,
  input: PoolAllocationInput
): TeamPoolQuota[] {
  const weights = input.weights ?? TEAM_WEIGHTS;
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const totalSlots = input.assistantsOnDuty * SLOTS_PER_POOL;

  return (Object.keys(weights) as TeamCode[]).map((team) => {
    const raw = (weights[team] / totalWeight) * totalSlots;
    return {
      team,
      pool,
      rawQuota: raw,
      // Default: keep 1 decimal; adjust rounding method based on hospital rules
      quota: Math.round(raw * 10) / 10,
    };
  });
}

/**
 * Calculate all team quotas for both AM + PM
 */
export function computeDailyAllocation(input: {
  amAssistantsOnDuty: number;
  pmAssistantsOnDuty: number;
  weights?: Record<TeamCode, number>;
}): TeamPoolQuota[] {
  return [
    ...computePoolAllocation("AM", {
      assistantsOnDuty: input.amAssistantsOnDuty,
      weights: input.weights,
    }),
    ...computePoolAllocation("PM", {
      assistantsOnDuty: input.pmAssistantsOnDuty,
      weights: input.weights,
    }),
  ];
}

// ─────────────────────────────────────────────
// §3.2 Remaining slot tracking + over-quota allowance
// ─────────────────────────────────────────────

export interface RemainingQuotaCheck {
  team: TeamCode;
  pool: SessionPool;
  quota: number;       // Original quota
  used: number;        // Assigned slots
  remaining: number;   // = quota - used, can be negative
  isOverQuota: boolean;
}

/**
 * Check team's remaining quota in a pool
 * remaining < 0 means over-quota — frontend should warn but still allow assignment (see §3.2)
 */
export function checkRemainingQuota(
  quota: TeamPoolQuota,
  usedSessions: number
): RemainingQuotaCheck {
  const remaining = quota.quota - usedSessions;
  return {
    team: quota.team,
    pool: quota.pool,
    quota: quota.quota,
    used: usedSessions,
    remaining,
    isOverQuota: remaining < 0,
  };
}

// ─────────────────────────────────────────────
// §2.4 Location optimization recommendation — three-tier priority
//
// Ward ID rules: cluster letter + floor number, e.g. "E8/19" → floor=8, room='E'.
// Bed number suffix does not affect distribution. Legacy "8E" is still accepted.
// Cluster 1 (West Wing): A,B,C,D ; Cluster 2 (East Wing): E,F,G,H
//
// Priority tiers (lower number = higher priority):
//   Tier 1 — Same floor, same cluster (best, e.g. assistant at E8, new task F8)
//   Tier 2 — Vertical adjacent (2nd best, e.g. assistant at E8, new task E9 — same room, different floor)
//   Tier 3 — Same cluster, different floor (e.g. assistant at E8, new task H9)
//   Tier 4 — Cross cluster (lowest, no transport score but visual hint)
// ─────────────────────────────────────────────

export interface ParsedWard {
  raw: string;
  floor: number;
  room: string;       // Uppercase letter
  cluster: WardCluster;
}

const CLUSTER_1_ROOMS = new Set(["A", "B", "C", "D"]);
const CLUSTER_2_ROOMS = new Set(["E", "F", "G", "H"]);

/**
 * Parse ward ID into floor + room + cluster.
 * Accepts "E8", "E8/19", "e8", and legacy "8E".
 */
export function parseWard(wardId: string): ParsedWard {
  const value = wardId.trim();
  const letterFirst = value.match(/^([A-Za-z])\s*(\d+)/);
  const legacyFloorFirst = value.match(/^(\d+)\s*([A-Za-z])/);

  let floor: number;
  let room: string;
  if (letterFirst) {
    room = letterFirst[1].toUpperCase();
    floor = parseInt(letterFirst[2], 10);
  } else if (legacyFloorFirst) {
    floor = parseInt(legacyFloorFirst[1], 10);
    room = legacyFloorFirst[2].toUpperCase();
  } else {
    throw new Error(`Invalid ward id: "${wardId}" (expected e.g. "E8" or "E8/19")`);
  }

  let cluster: WardCluster;
  if (CLUSTER_1_ROOMS.has(room)) cluster = "CLUSTER_1";
  else if (CLUSTER_2_ROOMS.has(room)) cluster = "CLUSTER_2";
  else throw new Error(`Unknown room "${room}" — not in Cluster 1 or 2`);

  return { raw: wardId, floor, room, cluster };
}

export enum LocationTier {
  SAME_FLOOR_SAME_CLUSTER = 1, // Same floor, same cluster
  VERTICAL_SAME_ROOM = 2,      // Same room, different floor
  SAME_CLUSTER = 3,            // Same cluster but different floor/room
  CROSS_CLUSTER = 4,           // Cross cluster
}

/**
 * Compare proximity of two wards, return a tier (1=closest, 4=farthest)
 */
export function compareWardProximity(a: ParsedWard, b: ParsedWard): LocationTier {
  const sameCluster = a.cluster === b.cluster;
  const sameFloor = a.floor === b.floor;
  const sameRoom = a.room === b.room;

  if (sameCluster && sameFloor) return LocationTier.SAME_FLOOR_SAME_CLUSTER;
  if (sameRoom) return LocationTier.VERTICAL_SAME_ROOM;
  if (sameCluster) return LocationTier.SAME_CLUSTER;
  return LocationTier.CROSS_CLUSTER;
}

/**
 * Calculate best priority tier for an assistant toward a new task ward.
 * Takes the "closest" tier (smallest number) among today's existing tasks.
 * If assistant has no tasks today, returns CROSS_CLUSTER (neutral, determined by load balancing).
 */
export function assistantWardTier(
  assistantExistingWards: string[],
  targetWard: string
): LocationTier {
  if (assistantExistingWards.length === 0) return LocationTier.CROSS_CLUSTER;
  const target = parseWard(targetWard);
  return assistantExistingWards
    .map((w) => compareWardProximity(parseWard(w), target))
    .reduce((best, t) => (t < best ? t : best), LocationTier.CROSS_CLUSTER);
}

export interface AssistantCandidate {
  assistantId: string;
  existingWards: string[];   // Assistant's already assigned wards today
  totalScore: number;        // Cumulative work score (§2.4 load balancing)
  isBusy?: boolean;          // Already assigned for this slot — overlap prevention
}

export interface RankedCandidate extends AssistantCandidate {
  tier: LocationTier;
  crossClusterWarning: boolean; // §2.4 cross-cluster visual hint
  isBusy: boolean;
}

/**
 * Assistant ranking for therapist assignment.
 * Priority:
 *   1) Non-busy first (busy pushed to end)
 *   2) Lower tier first (1 same-floor-same-cluster → 2 vertical → 3 same-cluster → 4 cross-cluster)
 *   3) Within same tier, lower cumulative score first (load balancing)
 */
export function rankAssistantsForWard(
  candidates: AssistantCandidate[],
  targetWard: string
): RankedCandidate[] {
  return candidates
    .map<RankedCandidate>((c) => {
      const tier = assistantWardTier(c.existingWards, targetWard);
      return {
        ...c,
        tier,
        crossClusterWarning: tier === LocationTier.CROSS_CLUSTER,
        isBusy: !!c.isBusy,
      };
    })
    .sort((a, b) => {
      if (a.isBusy !== b.isBusy) return a.isBusy ? 1 : -1;
      if (a.tier !== b.tier) return a.tier - b.tier;
      return a.totalScore - b.totalScore;
    });
}

// ─────────────────────────────────────────────
// S1 task scoring — content contains "MoCA" = 2 pts, others = 1 pt
// ─────────────────────────────────────────────
export function computeScore(content: string | null | undefined): number {
  if (!content) return 1;
  return /moca/i.test(content) ? 2 : 1;
}

// ─────────────────────────────────────────────
// S1 batch task dispatch (dispatchTasksByLocation)
//
// Rules:
// - Heavy tasks (high score) dispatched first to minimize final score variance
// - Prefer same cluster / adjacent floors (reuse §2.4 four tiers)
// - Within same tier, lower cumulative score first (load balancing)
//
// Single function serves:
//   1) 08:45 batch: dispatch all pending tasks at once
//   2) Post-08:45 real-time: single task + current assistant state
// ─────────────────────────────────────────────

export interface PendingTask {
  id: string;
  ward: string;
  score: number;
  specialty?: S1Specialty | string | null;
}

export interface DispatchCandidate {
  id: string;
  currentWards: string[];
  currentScore: number;
  homeTeam?: TeamCode | null;
}

export function dispatchTasksByLocation(
  tasks: PendingTask[],
  candidates: DispatchCandidate[]
): { taskId: string; assistantId: string }[] {
  if (candidates.length === 0) return [];

  // Local mutable state — reflects cumulative scores after each assignment
  const score = new Map(candidates.map((c) => [c.id, c.currentScore]));
  const wards = new Map(candidates.map((c) => [c.id, [...c.currentWards]]));

  // High-score tasks first (better total score balance)
  const sorted = [...tasks].sort((a, b) => b.score - a.score);
  const result: { taskId: string; assistantId: string }[] = [];

  for (const task of sorted) {
    let target: ParsedWard | null = null;
    try { target = parseWard(task.ward); } catch { /* unparseable → all tier 4 */ }
    const preferredTeam = S1_SPECIALTY_TEAM[task.specialty as S1Specialty];
    const hasPreferredTeamOnDuty = preferredTeam
      ? candidates.some((c) => c.homeTeam === preferredTeam)
      : false;

    const ranked = candidates
      .map((c) => {
        const myWards = wards.get(c.id)!;
        let tier: LocationTier = LocationTier.CROSS_CLUSTER;
        if (target && myWards.length > 0) {
          for (const w of myWards) {
            try {
              const t = compareWardProximity(parseWard(w), target);
              if (t < tier) tier = t;
            } catch { /* skip */ }
          }
        }
        const specialtyRank = hasPreferredTeamOnDuty && c.homeTeam !== preferredTeam ? 1 : 0;
        return { id: c.id, tier, score: score.get(c.id)!, specialtyRank };
      })
      .sort((a, b) => a.specialtyRank - b.specialtyRank || a.tier - b.tier || a.score - b.score);

    const winner = ranked[0];
    result.push({ taskId: task.id, assistantId: winner.id });
    wards.get(winner.id)!.push(task.ward);
    score.set(winner.id, winner.score + task.score);
  }

  return result;
}

// ─────────────────────────────────────────────
// §S2-S5 Auto-distribution (autoDistributeS2S5)
//
// Rules:
// - S2-S5 auto-filled by system based on 5 team weights (3.5:4:2:4:2)
// - AM pool (S2+S3) and PM pool (S4+S5) allocated separately
// - Each pool total slot = 2 × assistants on duty for that pool
// - Uses Hamilton largest remainder method (LRM) to ensure integer sum equals total slots
// - Block preference: each assistant's two slots per pool (S2+S3 or S4+S5) should be same team
// - Remainder split: if a team has only 1 slot left in a pool, split the assistant's block across 2 teams
// - Continuity: PM allocation prefers reusing the assistant's AM team;
//           home team (assistant's own) is secondary preference
// - Geographic continuity: sort assistants with S1 cluster preference matching home team cluster first
// ─────────────────────────────────────────────

export interface AutoDistAssistant {
  id: string;
  homeTeam: TeamCode | null;
  s1Wards: string[];      // Used for geographic continuity: determine dominant cluster
  onDutyAM: boolean;      // S2+S3
  onDutyPM: boolean;      // S4+S5
  unavailableSlots?: SlotCode[];
}

export interface AutoDistAssignment {
  assistantId: string;
  slot: Exclude<SlotCode, "S1">;
  team: TeamCode;
}

const TEAMS_ORDER: TeamCode[] = ["NS", "STROKE", "SURGICAL", "ORTHO", "PEDS"];

/** Hamilton largest remainder method: allocate totalSlots to teams proportionally by weight, ensuring integer sum. */
export function hamiltonAllocate(
  totalSlots: number,
  weights: Record<TeamCode, number>
): Record<TeamCode, number> {
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const raw: Record<TeamCode, number> = {} as Record<TeamCode, number>;
  const floors: Record<TeamCode, number> = {} as Record<TeamCode, number>;
  const remainders: { team: TeamCode; r: number }[] = [];

  for (const t of TEAMS_ORDER) {
    raw[t] = (totalSlots * weights[t]) / totalWeight;
    floors[t] = Math.floor(raw[t]);
    remainders.push({ team: t, r: raw[t] - floors[t] });
  }
  let used = TEAMS_ORDER.reduce((s, t) => s + floors[t], 0);
  // Allocate remaining slots to teams with largest remainder (stable sort: same remainder → TEAMS_ORDER)
  remainders.sort((a, b) => b.r - a.r);
  for (let i = 0; used < totalSlots && i < remainders.length; i++) {
    floors[remainders[i].team]++;
    used++;
  }
  return floors;
}

/** Get the most frequent cluster from assistant's S1 tasks, used as geographic preference */
function dominantCluster(s1Wards: string[]): WardCluster | null {
  if (s1Wards.length === 0) return null;
  let c1 = 0, c2 = 0;
  for (const w of s1Wards) {
    try {
      const p = parseWard(w);
      if (p.cluster === "CLUSTER_1") c1++;
      else c2++;
    } catch { /* skip invalid */ }
  }
  if (c1 === c2) return null;
  return c1 > c2 ? "CLUSTER_1" : "CLUSTER_2";
}

/** Team → primary service cluster mapping (hospital rules; heuristic used here) */
const TEAM_HOME_CLUSTER: Record<TeamCode, WardCluster> = {
  NS: "CLUSTER_1",
  STROKE: "CLUSTER_1",
  SURGICAL: "CLUSTER_2",
  ORTHO: "CLUSTER_2",
  PEDS: "CLUSTER_1",
};

/**
 * Sort assistants: those with strong geographic preference (have S1 cluster) first,
 * so they get priority for their corresponding cluster's team.
 */
function rankByGeographicPreference(assistants: AutoDistAssistant[]): AutoDistAssistant[] {
  return [...assistants].sort((a, b) => {
    const ca = dominantCluster(a.s1Wards);
    const cb = dominantCluster(b.s1Wards);
    if (!!ca === !!cb) return 0;
    return ca ? -1 : 1; // Preferenced first
  });
}

/** Select supporting team for a single assistant */
function pickTeamForAssistant(
  assistant: AutoDistAssistant,
  remaining: Record<TeamCode, number>,
  alreadyAssignedTeam: TeamCode | null,  // Assistant's team from other pool (continuity preference)
  needed: number,                         // Default 2 (two slots per pool); <1 means split
  options?: { preferHomeTeamFirst?: boolean }
): TeamCode | null {
  const candidates = TEAMS_ORDER.filter((t) => remaining[t] >= 1);
  if (candidates.length === 0) return null;
  const preferHomeTeamFirst = !!options?.preferHomeTeamFirst;

  // 1. Continuity: reuse team from other pool if still has demand
  if (alreadyAssignedTeam && remaining[alreadyAssignedTeam] >= needed) {
    return alreadyAssignedTeam;
  }

  // 2. Full manpower / home-priority mode: try assistant home team first.
  // Quota-safe: only choose it if the team still has enough remaining demand.
  if (preferHomeTeamFirst && assistant.homeTeam && remaining[assistant.homeTeam] >= needed) {
    return assistant.homeTeam;
  }

  // 3. Geographic preference: assistant S1 in a cluster → prefer same cluster's team
  const cluster = dominantCluster(assistant.s1Wards);
  if (cluster) {
    const sameCluster = candidates.filter(
      (t) => TEAM_HOME_CLUSTER[t] === cluster && remaining[t] >= needed
    );
    if (sameCluster.length > 0) {
      return sameCluster.reduce((m, t) => remaining[t] > remaining[m] ? t : m);
    }
  }

  // 4. Home team (default priority)
  if (assistant.homeTeam && remaining[assistant.homeTeam] >= needed) {
    return assistant.homeTeam;
  }

  // 5. Highest demand team (prefer ones that can fit the whole block)
  const fitting = candidates.filter((t) => remaining[t] >= needed);
  if (fitting.length > 0) {
    return fitting.reduce((m, t) => remaining[t] > remaining[m] ? t : m);
  }

  // 6. Fallback: any team with remaining demand (for splitting)
  return candidates.reduce((m, t) => remaining[t] > remaining[m] ? t : m);
}

/**
 * Split "full-day team target" across two pools by amCap/pmCap ratio.
 * Guarantees: sum(am) === amCap, sum(pm) === pmCap, and am[t] + pm[t] === target[t].
 * Uses secondary Hamilton to ensure integer sum conservation.
 */
export function splitTargetAcrossPools(
  teamTarget: Record<TeamCode, number>,
  amCap: number,
  pmCap: number
): { am: Record<TeamCode, number>; pm: Record<TeamCode, number> } {
  const total = amCap + pmCap;
  const am: Record<TeamCode, number> = {} as Record<TeamCode, number>;
  const pm: Record<TeamCode, number> = {} as Record<TeamCode, number>;

  if (total === 0) {
    for (const t of TEAMS_ORDER) { am[t] = 0; pm[t] = 0; }
    return { am, pm };
  }

  const remainders: { team: TeamCode; r: number }[] = [];
  let floorSum = 0;
  for (const t of TEAMS_ORDER) {
    const raw = (teamTarget[t] * amCap) / total;
    am[t] = Math.floor(raw);
    floorSum += am[t];
    remainders.push({ team: t, r: raw - am[t] });
  }

  let extras = amCap - floorSum;
  remainders.sort((a, b) => b.r - a.r);
  for (let i = 0; extras > 0 && i < remainders.length; i++) {
    const t = remainders[i].team;
    if (am[t] < teamTarget[t]) {
      am[t]++;
      extras--;
    }
  }
  for (const t of TEAMS_ORDER) pm[t] = teamTarget[t] - am[t];
  return { am, pm };
}

/**
 * S2-S5 auto-distribution main entry point
 *
 * Steps:
 * 1. Total daily slots = 2 × (AM on duty + PM on duty)
 * 2. Full-day Hamilton → each team's integer slot allocation
 * 3. Split team target by amCap/pmCap ratio into AM/PM pool targets
 * 4. Block assignment (continuity, geographic preference, home team) + remainder splitting
 */
export function autoDistributeS2S5(input: {
  assistants: AutoDistAssistant[];
  weights?: Record<TeamCode, number>;
}): AutoDistAssignment[] {
  const weights = input.weights ?? TEAM_WEIGHTS;
  const result: AutoDistAssignment[] = [];

  const getAvailablePoolSlots = (
    assistant: AutoDistAssistant,
    slots: Array<Exclude<SlotCode, "S1">>
  ) => slots.filter((slot) => !assistant.unavailableSlots?.includes(slot));

  const amCount = input.assistants.reduce(
    (sum, a) => sum + (a.onDutyAM ? getAvailablePoolSlots(a, ["S2", "S3"]).length : 0),
    0
  );
  const pmCount = input.assistants.reduce(
    (sum, a) => sum + (a.onDutyPM ? getAvailablePoolSlots(a, ["S4", "S5"]).length : 0),
    0
  );
  const totalAssistants = input.assistants.length;
  const amCap = amCount;
  const pmCap = pmCount;
  const totalSlots = amCap + pmCap;
  const isFullManpowerAM = amCount === totalAssistants * 2;
  const isFullManpowerPM = pmCount === totalAssistants * 2;

  // Full-day Hamilton → split to pools
  const teamTotal = hamiltonAllocate(totalSlots, weights);
  const { am: amTargets, pm: pmTargets } = splitTargetAcrossPools(teamTotal, amCap, pmCap);

  // Sort assistants (geographic preference first)
  const sorted = rankByGeographicPreference(input.assistants);

  // Round 1: AM (S2, S3)
  const amRemaining = { ...amTargets };
  const amTeamByAssistant: Record<string, TeamCode> = {};
  for (const a of sorted) {
    if (!a.onDutyAM) continue;
    const slots = getAvailablePoolSlots(a, ["S2", "S3"]);
    if (slots.length === 0) continue;
    const team1 = pickTeamForAssistant(a, amRemaining, null, slots.length, {
      preferHomeTeamFirst: isFullManpowerAM,
    });
    if (!team1) continue;
    if (amRemaining[team1] >= slots.length) {
      for (const slot of slots) result.push({ assistantId: a.id, slot, team: team1 });
      amRemaining[team1] -= slots.length;
      amTeamByAssistant[a.id] = team1;
    } else {
      // Split: first available slot goes to team1, second available slot goes to another team
      result.push({ assistantId: a.id, slot: slots[0], team: team1 });
      amRemaining[team1] -= 1;
      if (slots[1]) {
        const team2 = pickTeamForAssistant(a, amRemaining, null, 1, {
          preferHomeTeamFirst: isFullManpowerAM,
        });
        if (team2) {
          result.push({ assistantId: a.id, slot: slots[1], team: team2 });
          amRemaining[team2] -= 1;
        }
      }
      amTeamByAssistant[a.id] = team1; // Record first AM slot's team
    }
  }

  // Round 2: PM (S4, S5) — continuity preference: reuse AM team
  const pmRemaining = { ...pmTargets };
  for (const a of sorted) {
    if (!a.onDutyPM) continue;
    const slots = getAvailablePoolSlots(a, ["S4", "S5"]);
    if (slots.length === 0) continue;
    const amTeam = amTeamByAssistant[a.id] ?? null;
    const team1 = pickTeamForAssistant(a, pmRemaining, amTeam, slots.length, {
      preferHomeTeamFirst: isFullManpowerPM,
    });
    if (!team1) continue;
    if (pmRemaining[team1] >= slots.length) {
      for (const slot of slots) result.push({ assistantId: a.id, slot, team: team1 });
      pmRemaining[team1] -= slots.length;
    } else {
      result.push({ assistantId: a.id, slot: slots[0], team: team1 });
      pmRemaining[team1] -= 1;
      if (slots[1]) {
        const team2 = pickTeamForAssistant(a, pmRemaining, null, 1, {
          preferHomeTeamFirst: isFullManpowerPM,
        });
        if (team2) {
          result.push({ assistantId: a.id, slot: slots[1], team: team2 });
          pmRemaining[team2] -= 1;
        }
      }
    }
  }

  // Post-processing: eliminate quota imbalance >= ±1
  return rebalanceAllocations(result, amTargets, pmTargets);
}

/**
 * Quota rebalancing (rebalance pass) — post-processing for autoDistributeS2S5.
 *
 * Motivation: the first phase prioritizes "continuity + geographic preference", which may cause
 * one team to get 1 more block than target and another team 1 less (i.e., ±1 deviation).
 * This phase scans each pool:
 *        If an OVER team (actual - target >= 1) and an UNDER team (actual - target <= -1) exist,
 *        find a slot assigned to OVER in the pool and reassign it to UNDER.
 *        Repeat until no deviation >= 1.
 *
 * Trade-off: the affected assistant cross-supports for one slot, but keeps the original team for the other three.
 *           Overall fairness improves significantly (|deviation| < 1); continuity sacrifices one slot.
 */
export function rebalanceAllocations(
  allocations: AutoDistAssignment[],
  amTargets: Record<TeamCode, number>,
  pmTargets: Record<TeamCode, number>
): AutoDistAssignment[] {
  const result = allocations.map((a) => ({ ...a }));

  const POOLS: Array<{
    slotMatch: (s: SlotCode) => boolean;
    target: Record<TeamCode, number>;
  }> = [
    { slotMatch: (s) => s === "S2" || s === "S3", target: amTargets },
    { slotMatch: (s) => s === "S4" || s === "S5", target: pmTargets },
  ];

  for (const pool of POOLS) {
    const poolRows = result.filter((r) => pool.slotMatch(r.slot));

    // Safety: max 2 × team count iterations to prevent infinite loops in edge cases
    for (let iter = 0; iter < TEAMS_ORDER.length * 2; iter++) {
      // Count actual slots per team
      const counts: Record<TeamCode, number> = {} as Record<TeamCode, number>;
      for (const t of TEAMS_ORDER) counts[t] = 0;
      for (const r of poolRows) counts[r.team]++;

      // Find most over / most under
      let over: TeamCode | null = null;
      let under: TeamCode | null = null;
      let overExcess = 0;
      let underDeficit = 0;
      for (const t of TEAMS_ORDER) {
        const diff = counts[t] - pool.target[t];
        if (diff >= 1 && diff > overExcess) { over = t; overExcess = diff; }
        if (diff <= -1 && diff < underDeficit) { under = t; underDeficit = diff; }
      }
      if (over === null || under === null) break;

      // Find a slot currently assigned to OVER in pool, reassign to UNDER
      const swap = poolRows.find((r) => r.team === over);
      if (!swap) break;
      swap.team = under;
    }
  }

  return result;
}

/** Name alias — matches spec's generateDailySchedule naming */
export const generateDailySchedule = autoDistributeS2S5;
