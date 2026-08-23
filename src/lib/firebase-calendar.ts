"use client";

import { get, onValue, ref, update, type Unsubscribe } from "firebase/database";
import { ensureAnonymousAuth, firebaseDb } from "./firebase";
import {
  ensureFirebasePrototypeSeed,
  type FirebaseAssignment,
  type FirebaseAttendance,
  type FirebaseStaff,
} from "./firebase-data";
import { generateFirebaseAutoSchedule } from "./firebase-pca";
import { AttendanceStatus, TEAM_LABEL, TEAM_ORDER, type SlotCode, type TeamCode } from "@/types/db-enums";
import type { LeaveDuration, LeaveType } from "./attendance";

function daysInMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const total = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: total }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}

function isWeekday(date: string) {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

type AttendanceByDate = Record<string, Record<string, FirebaseAttendance>>;
type AssignmentsByDate = Record<string, Record<string, FirebaseAssignment>>;

function parseAttendanceNote(note: string | null | undefined) {
  if (!note) return {} as Record<string, unknown>;
  try {
    return JSON.parse(note) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}

function buildFirebaseCalendarMonth(
  month: string,
  allStaff: FirebaseStaff[],
  attendanceByDate: AttendanceByDate,
  assignmentsByDate: AssignmentsByDate
) {
  const staff = allStaff.filter(
    (member) => member.active !== false && member.role === "ASSISTANT"
  );
  const dates = daysInMonth(month);
  const days = dates.map((date) => {
    const records = attendanceByDate[date] ?? {};
    return {
      date,
      day: Number(date.slice(-2)),
      weekday: isWeekday(date),
      leaves: staff.flatMap((member) => {
        const record = records[member.id];
        if (!record || record.status === AttendanceStatus.PRESENT) return [];
        const parsed = parseAttendanceNote(record.note);
        return [{
          staffId: member.id,
          name: member.name,
          team: member.team as TeamCode | null,
          status: record.status,
          leaveType: typeof parsed.leaveType === "string" ? parsed.leaveType : null,
          leaveDuration: typeof parsed.leaveDuration === "string" ? parsed.leaveDuration : null,
          unavailableSlots: Array.isArray(parsed.unavailableSlots)
            ? parsed.unavailableSlots as SlotCode[]
            : [],
        }];
      }),
    };
  });
  const roster = [];
  const byId = new Map(staff.map((member) => [member.id, member]));
  for (const date of dates.filter(isWeekday)) {
    const rows = Object.values(assignmentsByDate[date] ?? {});
    const board = Object.fromEntries(
      TEAM_ORDER.map((team) => [team, { S2: [], S3: [], S4: [], S5: [] }])
    ) as Record<string, Record<string, { id: string; name: string; homeTeam: TeamCode | null }[]>>;
    for (const row of rows) {
      if (!row.supportTeam || row.slot === "S1" || !row.assistantId) continue;
      const member = byId.get(row.assistantId);
      if (member) {
        board[row.supportTeam][row.slot].push({
          id: member.id,
          name: member.name,
          homeTeam: member.team,
        });
      }
    }
    roster.push({ date, board });
  }
  return {
    assistants: staff.map((member) => ({ id: member.id, name: member.name, team: member.team })),
    days,
    roster,
  };
}

type CalendarMonthData = ReturnType<typeof buildFirebaseCalendarMonth>;
const calendarMonthCache = new Map<string, CalendarMonthData>();

export function getCachedFirebaseCalendarMonth(month: string) {
  return calendarMonthCache.get(month) ?? null;
}

export async function getFirebaseCalendarMonth(month: string) {
  await ensureFirebasePrototypeSeed();
  const [staffSnapshot, attendanceSnapshot, assignmentsSnapshot] = await Promise.all([
    get(ref(firebaseDb, "staff")),
    get(ref(firebaseDb, "attendance")),
    get(ref(firebaseDb, "assignments")),
  ]);
  const staffRows = (staffSnapshot.val() ?? {}) as Record<string, FirebaseStaff>;
  const data = buildFirebaseCalendarMonth(
    month,
    Object.entries(staffRows).map(([id, row]) => ({ ...row, id })),
    attendanceSnapshot.val() ?? {},
    assignmentsSnapshot.val() ?? {}
  );
  calendarMonthCache.set(month, data);
  return data;
}

export function listenToFirebaseCalendarMonth(
  month: string,
  onChange: (data: CalendarMonthData) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  let cancelled = false;
  let staff: FirebaseStaff[] | null = null;
  let attendance: AttendanceByDate | null = null;
  let assignments: AssignmentsByDate | null = null;
  const unsubscribes: Unsubscribe[] = [];

  const emit = () => {
    if (cancelled || !staff || !attendance || !assignments) return;
    const data = buildFirebaseCalendarMonth(month, staff, attendance, assignments);
    calendarMonthCache.set(month, data);
    onChange(data);
  };

  void ensureFirebasePrototypeSeed()
    .then(() => {
      if (cancelled) return;
      unsubscribes.push(
        onValue(
          ref(firebaseDb, "staff"),
          (snapshot) => {
            const rows = (snapshot.val() ?? {}) as Record<string, FirebaseStaff>;
            staff = Object.entries(rows).map(([id, row]) => ({ ...row, id }));
            emit();
          },
          (error) => onError?.(error)
        ),
        onValue(
          ref(firebaseDb, "attendance"),
          (snapshot) => {
            attendance = (snapshot.val() ?? {}) as AttendanceByDate;
            emit();
          },
          (error) => onError?.(error)
        ),
        onValue(
          ref(firebaseDb, "assignments"),
          (snapshot) => {
            assignments = (snapshot.val() ?? {}) as AssignmentsByDate;
            emit();
          },
          (error) => onError?.(error)
        )
      );
    })
    .catch((error: unknown) =>
      onError?.(error instanceof Error ? error : new Error("Firebase connection failed"))
    );

  return () => {
    cancelled = true;
    unsubscribes.forEach((unsubscribe) => unsubscribe());
  };
}

export async function setFirebaseCalendarLeave(args: {
  date: string;
  endDate?: string;
  staffId: string;
  leaveType: LeaveType;
  duration: LeaveDuration;
  unavailableSlots?: SlotCode[];
}) {
  await ensureAnonymousAuth();
  const start = new Date(`${args.date}T00:00:00.000Z`);
  const end = new Date(`${args.endDate ?? args.date}T00:00:00.000Z`);
  const changes: Record<string, unknown> = {};
  for (const current = new Date(start); current <= end; current.setUTCDate(current.getUTCDate() + 1)) {
    const date = current.toISOString().slice(0, 10);
    const status = args.duration === "FULL_DAY" ? "LEAVE" : args.duration === "AM" ? "PM_ONLY" : args.duration === "PM" ? "AM_ONLY" : "OTHER";
    const slots = args.duration === "FULL_DAY" ? ["S1", "S2", "S3", "S4", "S5"] : args.duration === "AM" ? ["S1", "S2", "S3"] : args.duration === "PM" ? ["S4", "S5"] : args.unavailableSlots ?? [];
    changes[`attendance/${date}/${args.staffId}`] = { status, note: JSON.stringify({ unavailableSlots: slots, leaveType: args.leaveType, leaveDuration: args.duration }) };
  }
  await update(ref(firebaseDb), changes);
}

export async function generateFirebaseMonthlyRoster(month = "") {
  if (!month) return { days: 0, assignments: 0 };
  const dates = daysInMonth(month).filter(isWeekday);
  let assignments = 0;
  for (const date of dates) assignments += (await generateFirebaseAutoSchedule(date)).count;
  return { days: dates.length, assignments };
}
