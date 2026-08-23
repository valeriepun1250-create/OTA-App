"use client";

import { get, onValue, ref, update, type Unsubscribe } from "firebase/database";
import { ensureAnonymousAuth, firebaseDb } from "./firebase";
import {
  ensureFirebasePrototypeSeed,
  readStaff,
  updateStaff,
  type FirebaseAttendance,
  type FirebaseStaff,
} from "./firebase-data";
import { AttendanceStatus, TEAM_ORDER, type SlotCode, type TeamCode } from "@/types/db-enums";
import { parseUnavailableSlots } from "./attendance";

function dailyAttendanceRows(
  staff: FirebaseStaff[],
  records: Record<string, FirebaseAttendance>
) {
  return staff
    .filter((member) => member.active !== false && member.role === "ASSISTANT")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((member) => ({
      id: member.id,
      name: member.name,
      team: member.team,
      defaultStatus: member.defaultStatus,
      todayStatus: (records[member.id]?.status ?? member.defaultStatus) as AttendanceStatus,
      unavailableSlots: parseUnavailableSlots(records[member.id]?.note),
    }));
}

function teamWeights(rows: Record<string, { weight?: number }>): Record<TeamCode, number> {
  return Object.fromEntries(
    TEAM_ORDER.map((team) => [team, rows[team]?.weight ?? 0])
  ) as Record<TeamCode, number>;
}

type DailyAttendanceRows = ReturnType<typeof dailyAttendanceRows>;
type AttendancePageData = {
  assistants: DailyAttendanceRows;
  weights: Record<TeamCode, number>;
};

const attendancePageCache = new Map<string, AttendancePageData>();

export function getCachedFirebaseAttendancePage(date: string) {
  return attendancePageCache.get(date) ?? null;
}

export async function preloadFirebaseAttendancePage(date: string) {
  if (attendancePageCache.has(date)) return;
  const [assistants, weights] = await Promise.all([
    getFirebaseDailyAttendance(date),
    getFirebaseTeamWeights(),
  ]);
  attendancePageCache.set(date, { assistants, weights });
}

export function listenToFirebaseAttendancePage(
  date: string,
  onChange: (data: AttendancePageData) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  let cancelled = false;
  let staff: FirebaseStaff[] | null = null;
  let attendance: Record<string, FirebaseAttendance> | null = null;
  let weights: Record<TeamCode, number> | null = null;
  const unsubscribes: Unsubscribe[] = [];

  const emit = () => {
    if (cancelled || !staff || !attendance || !weights) return;
    const data = { assistants: dailyAttendanceRows(staff, attendance), weights };
    attendancePageCache.set(date, data);
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
          ref(firebaseDb, `attendance/${date}`),
          (snapshot) => {
            attendance = (snapshot.val() ?? {}) as Record<string, FirebaseAttendance>;
            emit();
          },
          (error) => onError?.(error)
        ),
        onValue(
          ref(firebaseDb, "teams"),
          (snapshot) => {
            weights = teamWeights(snapshot.val() ?? {});
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

export async function getFirebaseDailyAttendance(date: string) {
  await ensureAnonymousAuth();
  const [staff, attendanceSnapshot] = await Promise.all([
    readStaff(),
    get(ref(firebaseDb, `attendance/${date}`)),
  ]);
  const records = (attendanceSnapshot.val() ?? {}) as Record<string, FirebaseAttendance>;
  return dailyAttendanceRows(staff, records);
}

export async function getFirebaseTeamWeights(): Promise<Record<TeamCode, number>> {
  await ensureAnonymousAuth();
  const snapshot = await get(ref(firebaseDb, "teams"));
  const rows = (snapshot.val() ?? {}) as Record<string, { weight?: number }>;
  return teamWeights(rows);
}

export async function setFirebaseAttendanceBatch(args: {
  date: string;
  updates: { staffId: string; status: AttendanceStatus; unavailableSlots?: SlotCode[] }[];
}) {
  await ensureAnonymousAuth();
  const changes: Record<string, FirebaseAttendance> = {};
  for (const row of args.updates) {
    changes[`attendance/${args.date}/${row.staffId}`] = {
      status: row.status,
      note: row.status === AttendanceStatus.OTHER
        ? JSON.stringify({ unavailableSlots: row.unavailableSlots ?? [] })
        : null,
    };
  }
  await update(ref(firebaseDb), changes);
}

export async function updateFirebaseTeamWeights(weights: Record<TeamCode, number>) {
  await ensureAnonymousAuth();
  const changes: Record<string, number> = {};
  for (const team of TEAM_ORDER) changes[`teams/${team}/weight`] = weights[team] ?? 0;
  await update(ref(firebaseDb), changes);
}

export async function addFirebaseAssistant(args: {
  name: string;
  teamCode: TeamCode;
  defaultStatus: AttendanceStatus;
}) {
  await ensureAnonymousAuth();
  const staff = await readStaff();
  const lastNumber = staff.reduce((max, member) => {
    const match = /^A(\d+)$/.exec(member.staffNo);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  const id = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await update(ref(firebaseDb, `staff/${id}`), {
    id,
    staffNo: `A${String(lastNumber + 1).padStart(3, "0")}`,
    name: args.name,
    role: "ASSISTANT",
    team: args.teamCode,
    active: true,
    canManageAttendance: false,
    defaultStatus: args.defaultStatus,
  });
}

export async function updateFirebaseAssistant(args: {
  id: string;
  name?: string;
  teamCode?: TeamCode;
  defaultStatus?: AttendanceStatus;
}) {
  await updateStaff(args.id, {
    ...(args.name !== undefined ? { name: args.name } : {}),
    ...(args.teamCode !== undefined ? { team: args.teamCode } : {}),
    ...(args.defaultStatus !== undefined ? { defaultStatus: args.defaultStatus } : {}),
  });
}

export async function deactivateFirebaseAssistant(id: string) {
  await updateStaff(id, { active: false });
}
