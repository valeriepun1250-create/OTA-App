"use server";

import { prisma } from "@/lib/prisma";
import {
  SLOT_TO_POOL,
  encodeAttendanceNote,
  encodeUnavailableSlots,
  isAvailableForSlot,
  type LeaveDuration,
  type LeaveType,
  parseUnavailableSlots,
} from "@/lib/attendance";
import {
  parseWard,
  autoDistributeS2S5,
  computeScore,
  dispatchTasksByLocation,
} from "@/lib/allocation";
import { getCurrentUser, getTeamWeights } from "./queries";
import { S1_SPECIALTY_OPTIONS, TEAM_ORDER, type S1Specialty, type TeamCode } from "@/types/db-enums";
import { AssignmentStatus, AttendanceStatus, Role, type SlotCode } from "@/types/db-enums";
import { revalidatePath } from "next/cache";

function toDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function getHongKongDateTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    dateStr: `${get("year")}-${get("month")}-${get("day")}`,
    hhmm: `${get("hour")}:${get("minute")}`,
  };
}

function isExpiredS1Date(dateStr: string): boolean {
  const now = getHongKongDateTimeParts();
  return dateStr < now.dateStr || (dateStr === now.dateStr && now.hhmm >= "23:59");
}

function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

function normalizeS1Specialty(input: string | null | undefined): S1Specialty {
  const value = input?.trim().toLowerCase();
  if (!value) return "Medical";
  return (
    S1_SPECIALTY_OPTIONS.find((option) => option.toLowerCase() === value) ??
    "Medical"
  );
}

function statusForLeaveDuration(duration: LeaveDuration): AttendanceStatus {
  if (duration === "FULL_DAY") return AttendanceStatus.LEAVE;
  if (duration === "AM") return AttendanceStatus.PM_ONLY;
  if (duration === "PM") return AttendanceStatus.AM_ONLY;
  return AttendanceStatus.OTHER;
}

function unavailableSlotsForLeaveDuration(
  duration: LeaveDuration,
  customSlots: SlotCode[] = []
): SlotCode[] {
  if (duration === "FULL_DAY") return ["S1", "S2", "S3", "S4", "S5"];
  if (duration === "AM") return ["S1", "S2", "S3"];
  if (duration === "PM") return ["S4", "S5"];
  return customSlots;
}

async function requireManageAttendance() {
  const user = await getCurrentUser();
  if (!user.canManageAttendance) {
    throw new Error("Forbidden: canManageAttendance permission required");
  }
  return user;
}

/** Write or update a single assistant's daily attendance status */
export async function setAttendance(args: {
  dateStr: string;
  staffId: string;
  status: AttendanceStatus;
  unavailableSlots?: SlotCode[];
}) {
  await requireManageAttendance();
  const date = toDate(args.dateStr);
  const note = args.status === AttendanceStatus.OTHER
    ? encodeUnavailableSlots(args.unavailableSlots ?? [])
    : null;
  await prisma.attendance.upsert({
    where: { date_staffId: { date, staffId: args.staffId } },
    create: { date, staffId: args.staffId, status: args.status, note },
    update: { status: args.status, note },
  });
  const existingGeneratedRows = await prisma.assignment.count({
    where: { date, slot: { in: ["S2", "S3", "S4", "S5"] } },
  });
  if (existingGeneratedRows > 0) {
    await writeAutoScheduleForDate(args.dateStr);
  }
  revalidatePath("/assign");
  revalidatePath("/attendance");
  revalidatePath("/calendar");
}

/** Batch submit entire daily attendance (attendance page "Submit") */
export async function setAttendanceBatch(args: {
  dateStr: string;
  updates: { staffId: string; status: AttendanceStatus; unavailableSlots?: SlotCode[] }[];
}) {
  await requireManageAttendance();
  const date = toDate(args.dateStr);
  await prisma.$transaction(
    args.updates.map((u) => {
      const note = u.status === AttendanceStatus.OTHER
        ? encodeUnavailableSlots(u.unavailableSlots ?? [])
        : null;
      return prisma.attendance.upsert({
        where: { date_staffId: { date, staffId: u.staffId } },
        create: { date, staffId: u.staffId, status: u.status, note },
        update: { status: u.status, note },
      });
    })
  );
  const existingGeneratedRows = await prisma.assignment.count({
    where: { date, slot: { in: ["S2", "S3", "S4", "S5"] } },
  });
  if (existingGeneratedRows > 0) {
    await writeAutoScheduleForDate(args.dateStr);
  }
  revalidatePath("/assign");
  revalidatePath("/attendance");
  revalidatePath("/calendar");
  return { count: args.updates.length };
}

export async function setCalendarLeave(args: {
  dateStr: string;
  endDateStr?: string;
  staffId: string;
  leaveType: LeaveType;
  duration: LeaveDuration;
  unavailableSlots?: SlotCode[];
}) {
  await requireManageAttendance();
  const start = toDate(args.dateStr);
  const end = args.endDateStr ? toDate(args.endDateStr) : start;
  const unavailableSlots = unavailableSlotsForLeaveDuration(args.duration, args.unavailableSlots);
  const dates: Date[] = [];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    dates.push(new Date(d));
  }

  await prisma.$transaction(
    dates.map((date) =>
      prisma.attendance.upsert({
        where: { date_staffId: { date, staffId: args.staffId } },
        create: {
          date,
          staffId: args.staffId,
          status: statusForLeaveDuration(args.duration),
          note: encodeAttendanceNote({
            unavailableSlots,
            leaveType: args.leaveType,
            leaveDuration: args.duration,
          }),
        },
        update: {
          status: statusForLeaveDuration(args.duration),
          note: encodeAttendanceNote({
            unavailableSlots,
            leaveType: args.leaveType,
            leaveDuration: args.duration,
          }),
        },
      })
    )
  );

  for (const date of dates) {
    const existingGeneratedRows = await prisma.assignment.count({
      where: { date, slot: { in: ["S2", "S3", "S4", "S5"] } },
    });
    if (existingGeneratedRows > 0) {
      await writeAutoScheduleForDate(formatDateKey(date));
    }
  }

  revalidatePath("/calendar");
  revalidatePath("/attendance");
  revalidatePath("/assign");
  revalidatePath(`/assistant/${args.staffId}`);
}

/** 8:45 batch dispatch cutoff time (HH:mm) */
const BATCH_CUTOFF = "08:45";
const S1_DAILY_DELETE_CUTOFF = "23:59";

/**
 * S1 tasks expire at 23:59 Hong Kong time.
 * This is opportunistic cleanup: it runs when the app/server is used, not from a background cron.
 */
export async function cleanupExpiredS1Tasks() {
  const now = getHongKongDateTimeParts();
  const today = toDate(now.dateStr);
  const where =
    now.hhmm >= S1_DAILY_DELETE_CUTOFF
      ? { slot: "S1", date: { lte: today } }
      : { slot: "S1", date: { lt: today } };

  const result = await prisma.assignment.deleteMany({ where });
  if (result.count > 0) {
    revalidatePath("/assign");
    revalidatePath("/assistant");
  }
  return { deleted: result.count };
}

/**
 * Therapist creates S1 task — no assistant specified.
 *   - If current time < 08:45 → goes to pending pool, wait for batch dispatch
 *   - If current time >= 08:45 → immediately dispatched to nearest assistant
 *   - score auto-calculated based on whether content contains "MoCA" (MoCA=2, others=1)
 */
export async function createTaskRequest(args: {
  dateStr: string;
  ward: string;
  initial?: string;
  hnPrefix?: string;
  therapistName?: string;
  specialty?: string;
  content: string;
}) {
  await cleanupExpiredS1Tasks();
  if (isExpiredS1Date(args.dateStr)) {
    throw new Error("S1 tasks are closed after 23:59 Hong Kong time");
  }

  if (
    !args.ward.trim() ||
    !args.initial?.trim() ||
    !args.hnPrefix?.trim() ||
    !args.therapistName?.trim() ||
    !args.specialty?.trim() ||
    !args.content.trim()
  ) {
    throw new Error("All New Task fields are required");
  }

  const score = computeScore(args.content);
  const specialty = normalizeS1Specialty(args.specialty);
  let cluster: string | null = null;
  try { cluster = parseWard(args.ward).cluster; } catch { /* parse failed */ }

  const created = await prisma.assignment.create({
    data: {
      date: toDate(args.dateStr),
      slot: "S1",
      pool: SLOT_TO_POOL["S1"],
      content: args.content,
      score,
      specialty,
      therapistName: args.therapistName,
      initial: args.initial,
      hnPrefix: args.hnPrefix,
      ward: args.ward,
      cluster,
      assistantId: null,           // pending
      wasOverQuota: false,
    },
  });

  // After 08:45 → auto-dispatch to nearest assistant
  if (getHongKongDateTimeParts().hhmm >= BATCH_CUTOFF) {
    await dispatchPendingTasks(args.dateStr);
  }

  revalidatePath("/assign");
  return created;
}

export async function deleteS1Task(assignmentId: string) {
  const existing = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { slot: true, assistantId: true },
  });
  if (!existing || existing.slot !== "S1") {
    throw new Error("S1 task not found");
  }

  await prisma.assignment.delete({ where: { id: assignmentId } });
  revalidatePath("/assign");
  if (existing.assistantId) revalidatePath(`/assistant/${existing.assistantId}`);
  return { deleted: 1 };
}

export async function updateS1TaskContent(args: {
  assignmentId: string;
  content: string;
}) {
  const content = args.content.trim();
  if (!content) throw new Error("Content is required");

  const existing = await prisma.assignment.findUnique({
    where: { id: args.assignmentId },
    select: { slot: true, assistantId: true },
  });
  if (!existing || existing.slot !== "S1") {
    throw new Error("S1 task not found");
  }

  const updated = await prisma.assignment.update({
    where: { id: args.assignmentId },
    data: {
      content,
      score: computeScore(content),
    },
  });

  revalidatePath("/assign");
  if (existing.assistantId) revalidatePath(`/assistant/${existing.assistantId}`);
  return updated;
}

/**
 * Dispatch all S1 pending tasks for the day using "same cluster + score balance" algorithm.
 * - Can be manually triggered (admin clicks button)
 * - Or auto-called after task creation (after 08:45)
 */
export async function dispatchPendingTasks(dateStr: string) {
  const date = toDate(dateStr);

  // 1. Fetch pending tasks
  const pending = await prisma.assignment.findMany({
    where: { date, slot: "S1", assistantId: null, status: { not: "CANCELLED" } },
  });
  if (pending.length === 0) return { dispatched: 0 };

  // 2. Fetch today's S1 assistants on duty + existing task accumulation
  const assistants = await prisma.staff.findMany({
    where: { role: "ASSISTANT", active: true },
    include: { team: true },
  });
  const attendances = await prisma.attendance.findMany({
    where: { date, staffId: { in: assistants.map((a) => a.id) } },
  });
  const attendanceByStaff = new Map(attendances.map((a) => [a.staffId, a]));

  const onDuty = assistants.filter((a) =>
    isAvailableForSlot(
      (attendanceByStaff.get(a.id)?.status ?? null) as AttendanceStatus | null,
      attendanceByStaff.get(a.id)?.note ?? null,
      "S1"
    )
  );

  const existing = await prisma.assignment.findMany({
    where: {
      date,
      slot: "S1",
      assistantId: { in: onDuty.map((a) => a.id) },
      status: { not: "CANCELLED" },
    },
  });

  const candidates = onDuty.map((a) => {
    const own = existing.filter((t) => t.assistantId === a.id);
    return {
      id: a.id,
      homeTeam: (a.team?.code ?? null) as TeamCode | null,
      currentWards: own.map((t) => t.ward),
      currentScore: own.reduce((s, t) => s + (t.score ?? 1), 0),
    };
  });

  // 3. Run algorithm
  const plan = dispatchTasksByLocation(
    pending.map((p) => ({ id: p.id, ward: p.ward, score: p.score, specialty: p.specialty })),
    candidates
  );

  // 4. One-time update
  const now = new Date();
  await prisma.$transaction(
    plan.map((p) =>
      prisma.assignment.update({
        where: { id: p.taskId },
        data: { assistantId: p.assistantId, dispatchedAt: now },
      })
    )
  );

  revalidatePath("/assign");
  // Notify corresponding assistant pages
  const touched = new Set(plan.map((p) => p.assistantId));
  for (const id of touched) revalidatePath(`/assistant/${id}`);

  return { dispatched: plan.length };
}

/**
 * S2-S5 auto-distribution schedule — regenerate all S2-S5 assignments for the day.
 * Steps:
 *   1. Read attendance → determine AM/PM duty for each assistant
 *   2. Read S1 tasks → get cluster preference for each assistant
 *   3. Run autoDistributeS2S5 algorithm
 *   4. Delete existing S2-S5 assignments (keep S1)
 *   5. Write new assignments (supportTeam, no therapist, no ward/task)
 */
export async function generateAutoSchedule(dateStr: string) {
  await requireManageAttendance();
  return writeAutoScheduleForDate(dateStr);
}

async function writeAutoScheduleForDate(dateStr: string) {
  const date = toDate(dateStr);

  // 1. Assistants + attendance
  const assistants = await prisma.staff.findMany({
    where: { role: Role.ASSISTANT, active: true },
    include: { team: true },
  });
  const attendances = await prisma.attendance.findMany({
    where: { date, staffId: { in: assistants.map((a) => a.id) } },
  });
  const attendanceByStaff = new Map(attendances.map((a) => [a.staffId, a]));

  // 2. S1 Task get ward (geographic preference)
  const s1s = await prisma.assignment.findMany({
    where: { date, slot: "S1", status: { not: "CANCELLED" } },
    select: { assistantId: true, ward: true },
  });
  const wardsByAssistant: Record<string, string[]> = {};
  for (const r of s1s) {
    if (r.assistantId) {
      (wardsByAssistant[r.assistantId] ??= []).push(r.ward);
    }
  }

  // 3. Schedule
  const distInput = assistants.map((a) => ({
    id: a.id,
    homeTeam: (a.team?.code ?? null) as TeamCode | null,
    s1Wards: wardsByAssistant[a.id] ?? [],
    onDutyAM:
      isAvailableForSlot(
        (attendanceByStaff.get(a.id)?.status ?? null) as AttendanceStatus | null,
        attendanceByStaff.get(a.id)?.note ?? null,
        "S2"
      ) ||
      isAvailableForSlot(
        (attendanceByStaff.get(a.id)?.status ?? null) as AttendanceStatus | null,
        attendanceByStaff.get(a.id)?.note ?? null,
        "S3"
      ),
    onDutyPM:
      isAvailableForSlot(
        (attendanceByStaff.get(a.id)?.status ?? null) as AttendanceStatus | null,
        attendanceByStaff.get(a.id)?.note ?? null,
        "S4"
      ) ||
      isAvailableForSlot(
        (attendanceByStaff.get(a.id)?.status ?? null) as AttendanceStatus | null,
        attendanceByStaff.get(a.id)?.note ?? null,
        "S5"
      ),
    unavailableSlots: parseUnavailableSlots(attendanceByStaff.get(a.id)?.note),
  }));
  const weights = await getTeamWeights();
  const allocations = autoDistributeS2S5({ assistants: distInput, weights });

  // 4. Delete old S2-S5
  await prisma.$transaction([
    prisma.assignment.deleteMany({
      where: { date, slot: { in: ["S2", "S3", "S4", "S5"] } },
    }),
    prisma.assignment.createMany({
      data: allocations.map((a) => ({
        date,
        slot: a.slot,
        pool: SLOT_TO_POOL[a.slot],
        assistantId: a.assistantId,
        supportTeam: a.team,
        therapistId: null,
        taskId: null,
        ward: "—",                   // S2-S5 auto allocation is team-level support, no specific ward
        cluster: "CLUSTER_1",        // Required field placeholder; not shown in UI
        wasOverQuota: false,
      })),
    }),
  ]);

  revalidatePath("/assign");
  revalidatePath("/calendar");
  // Notify all assistant pages
  for (const a of assistants) revalidatePath(`/assistant/${a.id}`);

  return { count: allocations.length };
}

export async function generateMonthlyAutoSchedule(monthStr: string) {
  await requireManageAttendance();
  const [year, month] = monthStr.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  let days = 0;
  let assignments = 0;

  for (let d = new Date(start); d < end; d = addDays(d, 1)) {
    if (!isWeekday(d)) continue;
    const result = await writeAutoScheduleForDate(formatDateKey(d));
    days++;
    assignments += result.count;
  }

  revalidatePath("/calendar");
  return { days, assignments };
}

// ─────────────────────────────────────────────
// Staff / Team weight CRUD — adjustable on attendance page
// ─────────────────────────────────────────────

/** Update Team therapist count (= weight). Does not change formula, only proportional input. */
export async function updateTeamWeights(weights: Record<TeamCode, number>) {
  await requireManageAttendance();
  await prisma.$transaction(
    TEAM_ORDER.map((code) =>
      prisma.team.update({
        where: { code },
        data: { weight: weights[code] },
      })
    )
  );
  revalidatePath("/attendance");
  revalidatePath("/assign");
}

/** Add new assistant */
export async function addAssistant(args: {
  name: string;
  teamCode: TeamCode;
  defaultStatus: AttendanceStatus;
}) {
  await requireManageAttendance();
  const team = await prisma.team.findUniqueOrThrow({ where: { code: args.teamCode } });
  // Auto-generate next staffNo: A001, A002, ...
  // Only consider ASSISTANT role to avoid "ADM001" prefix interference;
  // Use max(numeric part) not string sort to prevent "A9" > "A010" lexicographic issues
  const assistants = await prisma.staff.findMany({
    where: { role: "ASSISTANT" },
    select: { staffNo: true },
  });
  const lastNum = assistants.reduce((max, s) => {
    const m = /^A(\d+)$/.exec(s.staffNo);
    if (!m) return max;
    const n = parseInt(m[1], 10);
    return n > max ? n : max;
  }, 0);
  const staffNo = `A${String(lastNum + 1).padStart(3, "0")}`;

  await prisma.staff.create({
    data: {
      staffNo,
      name: args.name,
      role: "ASSISTANT",
      teamId: team.id,
      defaultStatus: args.defaultStatus,
    },
  });
  revalidatePath("/attendance");
  revalidatePath("/assign");
  revalidatePath("/");
}

/** Update assistant properties (name / team / defaultStatus) */
export async function updateAssistant(args: {
  id: string;
  name?: string;
  teamCode?: TeamCode;
  defaultStatus?: AttendanceStatus;
}) {
  await requireManageAttendance();
  const data: Record<string, unknown> = {};
  if (args.name !== undefined) data.name = args.name;
  if (args.defaultStatus !== undefined) data.defaultStatus = args.defaultStatus;
  if (args.teamCode !== undefined) {
    const team = await prisma.team.findUniqueOrThrow({ where: { code: args.teamCode } });
    data.teamId = team.id;
  }
  await prisma.staff.update({ where: { id: args.id }, data });
  revalidatePath("/attendance");
  revalidatePath("/assign");
  revalidatePath("/");
}

/** Deactivate assistant (soft delete — keeps historical assignments) */
export async function deactivateAssistant(id: string) {
  await requireManageAttendance();
  await prisma.staff.update({ where: { id }, data: { active: false } });
  revalidatePath("/attendance");
  revalidatePath("/assign");
  revalidatePath("/");
}

/** Assistant toggles task status (PENDING → IN_PROGRESS → DONE) */
export async function updateAssignmentStatus(args: {
  assignmentId: string;
  status: AssignmentStatus;
}) {
  const updated = await prisma.assignment.update({
    where: { id: args.assignmentId },
    data: { status: args.status },
  });
  revalidatePath(`/assistant/${updated.assistantId}`);
  return updated;
}

/** Assistant writes/updates note for task */
export async function updateAssignmentNote(args: {
  assignmentId: string;
  note: string;
}) {
  const updated = await prisma.assignment.update({
    where: { id: args.assignmentId },
    data: { note: args.note.trim() || null },
  });
  revalidatePath(`/assistant/${updated.assistantId}`);
  return updated;
}
