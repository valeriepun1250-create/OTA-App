"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  computePoolAllocation,
  rankAssistantsForWard,
  type RankedCandidate,
  type TeamPoolQuota,
} from "@/lib/allocation";
import {
  SLOT_TO_POOL,
  isAvailableForSlot,
  parseUnavailableSlots,
} from "@/lib/attendance";
import {
  AttendanceStatus,
  Role,
  SessionPool,
  SlotCode,
  TeamCode,
} from "@/types/db-enums";

/** Utility: convert "YYYY-MM-DD" to UTC 0:00 Date — Prisma @db.Date */
function toDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/** Temporary: get any therapist id (to be replaced by auth session in production) */
export async function getAnyTherapistId(): Promise<string> {
  const t = await prisma.staff.findFirst({ where: { role: Role.THERAPIST, active: true } });
  if (!t) throw new Error("No therapist in system — please seed staff first");
  return t.id;
}

/**
 * Get the current logged-in user.
 * Temporary cookie `currentStaffId` (swappable by dev);
 * Falls back to first staff with canManageAttendance for demo purposes.
 * Replace with auth().userId in production.
 */
export async function getCurrentUser() {
  const id = cookies().get("currentStaffId")?.value;
  let user = id
    ? await prisma.staff.findUnique({ where: { id } })
    : null;
  if (!user) {
    user = await prisma.staff.findFirst({
      where: { canManageAttendance: true, active: true },
    });
  }
  if (!user) throw new Error("No active staff — please run npm run db:seed");
  return user;
}

/** Get task dictionary + ward list (wards temporarily from existing Assignment stats, fallback if none) */
export async function getStaticOptions() {
  const tasks = await prisma.taskDictionary.findMany({
    where: { active: true },
    orderBy: { code: "asc" },
  });
  return {
    tasks,
    wards: [
      "3A","3B","3C","3D","3E","3F","3G","3H",
      "4A","4B","4C","4D","4E","4F","4G","4H",
      "5A","5B","5E","5F",
      "8E","8G",
    ],
  };
}

/** Get all assistants for the day + attendance status (null means not yet recorded) */
export async function getDailyAttendance(dateStr: string) {
  const date = toDate(dateStr);
  const assistants = await prisma.staff.findMany({
    where: { role: Role.ASSISTANT, active: true },
    include: { team: true },
    orderBy: { name: "asc" },
  });
  const records = await prisma.attendance.findMany({
    where: { date, staffId: { in: assistants.map((a) => a.id) } },
  });
  const byStaff = new Map(records.map((r) => [r.staffId, r]));

  return assistants.map((a) => ({
    id: a.id,
    name: a.name,
    team: a.team?.code ?? null,
    // Assistant profile default (should only change when user edits "Default")
    defaultStatus: a.defaultStatus as AttendanceStatus,
    // Daily effective status: attendance record if exists, otherwise default
    todayStatus: (byStaff.get(a.id)?.status ?? a.defaultStatus) as AttendanceStatus,
    unavailableSlots: parseUnavailableSlots(byStaff.get(a.id)?.note),
  }));
}

/** Get current Team weight settings — dynamic from DB, editable on attendance page */
export async function getTeamWeights(): Promise<Record<TeamCode, number>> {
  const teams = await prisma.team.findMany();
  const result = {} as Record<TeamCode, number>;
  for (const t of teams) result[t.code as TeamCode] = t.weight;
  return result;
}

/** Calculate daily AM + PM quotas per team */
export async function getDailyQuotas(dateStr: string): Promise<{
  am: TeamPoolQuota[];
  pm: TeamPoolQuota[];
  amOnDuty: number;
  pmOnDuty: number;
}> {
  const [attendance, weights] = await Promise.all([
    getDailyAttendance(dateStr),
    getTeamWeights(),
  ]);
  const amOnDuty = attendance.reduce(
    (sum, a) =>
      sum +
      (isAvailableForSlot(a.todayStatus, JSON.stringify({ unavailableSlots: a.unavailableSlots }), "S2") ? 0.5 : 0) +
      (isAvailableForSlot(a.todayStatus, JSON.stringify({ unavailableSlots: a.unavailableSlots }), "S3") ? 0.5 : 0),
    0
  );
  const pmOnDuty = attendance.reduce(
    (sum, a) =>
      sum +
      (isAvailableForSlot(a.todayStatus, JSON.stringify({ unavailableSlots: a.unavailableSlots }), "S4") ? 0.5 : 0) +
      (isAvailableForSlot(a.todayStatus, JSON.stringify({ unavailableSlots: a.unavailableSlots }), "S5") ? 0.5 : 0),
    0
  );

  return {
    am: computePoolAllocation("AM", { assistantsOnDuty: amOnDuty, weights }),
    pm: computePoolAllocation("PM", { assistantsOnDuty: pmOnDuty, weights }),
    amOnDuty,
    pmOnDuty,
  };
}

/**
 * Calculate used slots per team — counted by "actually supported team" (supportTeam),
 * not by the assistant's home team. This maps to "how many slots this team consumed".
 * S1 tasks have no supportTeam, automatically excluded.
 */
export async function getDailyTeamUsage(dateStr: string): Promise<Record<TeamCode, { am: number; pm: number }>> {
  const date = toDate(dateStr);
  const rows = await prisma.assignment.findMany({
    where: {
      date,
      status: { not: "CANCELLED" },
      supportTeam: { not: null },   // Only count S2-S5 auto allocations
    },
  });

  const usage: Record<string, { am: number; pm: number }> = {};
  for (const r of rows) {
    const code = r.supportTeam;
    if (!code) continue;
    if (!usage[code]) usage[code] = { am: 0, pm: 0 };
    if (r.pool === "AM") usage[code].am++;
    else if (r.pool === "PM") usage[code].pm++;
  }
  return usage as Record<TeamCode, { am: number; pm: number }>;
}

/** Get all S1 tasks for the day (including pending and dispatched) — for therapist assignment page */
export async function getDailyTaskRequests(dateStr: string) {
  const date = toDate(dateStr);
  const rows = await prisma.assignment.findMany({
    where: { date, slot: "S1", status: { not: "CANCELLED" } },
    include: {
      assistant: { include: { team: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    ward: r.ward,
    initial: r.initial,
    hnPrefix: r.hnPrefix,
    therapistName: r.therapistName,
    content: r.content,
    score: r.score,
    status: r.status,
    assistantId: r.assistantId,
    assistantName: r.assistant?.name ?? null,
    assistantTeam: r.assistant?.team?.code ?? null,
    isPending: r.assistantId === null,
    createdAt: r.createdAt,
    dispatchedAt: r.dispatchedAt,
  }));
}

/**
 * Recommend assistants: based on §2.4 three-tier proximity + load balancing + overlap prevention (busy)
 * Applies to S1 (task mode) and S2-S5 (reservation mode)
 */
export async function getRankedAssistants(args: {
  dateStr: string;
  slot: SlotCode;
  ward: string;
}): Promise<(RankedCandidate & { name: string; team: TeamCode | null; pool: SessionPool })[]> {
  const date = toDate(args.dateStr);
  const pool = SLOT_TO_POOL[args.slot];

  // Get assistants on duty for this pool
  const attendance = await getDailyAttendance(args.dateStr);
  const onDutyIds = attendance
    .filter((a) => {
      const s = a.todayStatus ?? AttendanceStatus.PRESENT;
      return isAvailableForSlot(
        s,
        JSON.stringify({ unavailableSlots: a.unavailableSlots }),
        args.slot
      );
    })
    .map((a) => a.id);

  const todays = await prisma.assignment.findMany({
    where: { date, assistantId: { in: onDutyIds }, status: { not: "CANCELLED" } },
    include: { task: true },
  });

  const candidates = onDutyIds.map((id) => {
    const own = todays.filter((t) => t.assistantId === id);
    return {
      assistantId: id,
      // Only take S1 real wards; S2-S5 auto allocation ward is a placeholder
      existingWards: own.filter((t) => t.slot === "S1").map((t) => t.ward),
      totalScore: own.reduce((sum, t) => sum + (t.task?.score ?? 0), 0),
      isBusy: own.some((t) => t.slot === args.slot), // §Overlap prevention
    };
  });

  const ranked = rankAssistantsForWard(candidates, args.ward);
  const lookup = new Map(attendance.map((a) => [a.id, a]));

  return ranked.map((r) => {
    const a = lookup.get(r.assistantId)!;
    return { ...r, name: a.name, team: (a.team ?? null) as TeamCode | null, pool };
  });
}

/** Assistant's full daily schedule — used by mobile dashboard */
export async function getAssistantDailySchedule(assistantId: string, dateStr: string) {
  const date = toDate(dateStr);
  const assistant = await prisma.staff.findUnique({
    where: { id: assistantId },
    include: { team: true },
  });
  if (!assistant) throw new Error("Assistant not found");

  const rows = await prisma.assignment.findMany({
    where: { date, assistantId, status: { not: "CANCELLED" } },
    include: {
      task: true,
      therapist: { include: { team: true } },
    },
    orderBy: [{ slot: "asc" }, { createdAt: "asc" }],
  });

  // S2-S5 merge consecutive same-team time slots into blocks, e.g. S2+S3 both support NS → 10:00-12:30 NS
  const SLOT_TIME: Record<SlotCode, [string, string]> = {
    S1: ["08:30", "10:00"],
    S2: ["10:00", "11:15"],
    S3: ["11:15", "12:30"],
    S4: ["13:30", "15:15"],
    S5: ["15:15", "17:00"],
  };

  const s2s5 = rows.filter((r) => r.slot !== "S1");
  const teamBlocks: { startSlot: SlotCode; endSlot: SlotCode; team: TeamCode | null; assignmentIds: string[]; status: string }[] = [];
  for (const r of s2s5) {
    const last = teamBlocks[teamBlocks.length - 1];
    const slotCode = r.slot as SlotCode;
    const isAdjacent = last && nextSlot(last.endSlot) === slotCode && last.team === r.supportTeam;
    if (isAdjacent) {
      last.endSlot = slotCode;
      last.assignmentIds.push(r.id);
    } else {
      teamBlocks.push({
        startSlot: slotCode,
        endSlot: slotCode,
        team: (r.supportTeam ?? null) as TeamCode | null,
        assignmentIds: [r.id],
        status: r.status,
      });
    }
  }
  const teamSchedule = teamBlocks.map((b) => ({
    timeRange: `${SLOT_TIME[b.startSlot][0]}-${SLOT_TIME[b.endSlot][1]}`,
    slots: b.startSlot === b.endSlot ? [b.startSlot] : [b.startSlot, b.endSlot],
    team: b.team,
    assignmentIds: b.assignmentIds,
  }));

  return {
    assistant: { id: assistant.id, name: assistant.name, team: assistant.team?.code ?? null },
    s1Tasks: rows.filter((r) => r.slot === "S1"),
    teamSchedule,
  };
}

function nextSlot(s: SlotCode): SlotCode | null {
  // Only allow intra-pool merging. S3 → S4 has lunch break (12:30-13:30), not adjacent
  const adjacent: Partial<Record<SlotCode, SlotCode>> = {
    S2: "S3",   // AM block
    S4: "S5",   // PM block
  };
  return adjacent[s] ?? null;
}

/**
 * S2-S5 system distribution board — displayed on therapist assignment page.
 * Returns which assistants support each team in each slot.
 */
export async function getDistributionBoard(dateStr: string) {
  const date = toDate(dateStr);
  const rows = await prisma.assignment.findMany({
    where: { date, slot: { in: ["S2", "S3", "S4", "S5"] }, status: { not: "CANCELLED" } },
    include: { assistant: { include: { team: true } } },
    orderBy: { slot: "asc" },
  });

  // Structure: team → slot → list of assistant names
  const board: Record<string, Record<string, { id: string; name: string; homeTeam: TeamCode | null }[]>> = {};
  for (const t of ["NS", "STROKE", "SURGICAL", "ORTHO", "PEDS"] as TeamCode[]) {
    board[t] = { S2: [], S3: [], S4: [], S5: [] };
  }
  for (const r of rows) {
    if (!r.supportTeam || !r.assistant) continue;
    const slotCode = r.slot as SlotCode;
    board[r.supportTeam][slotCode].push({
      id: r.assistant.id,
      name: r.assistant.name,
      homeTeam: (r.assistant.team?.code ?? null) as TeamCode | null,
    });
  }
  return { board, totalRows: rows.length };
}
