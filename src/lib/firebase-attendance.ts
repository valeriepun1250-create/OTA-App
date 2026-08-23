"use client";

import { get, ref, update } from "firebase/database";
import { ensureAnonymousAuth, firebaseDb } from "./firebase";
import { readStaff, setDailyAttendance, updateStaff, type FirebaseAttendance } from "./firebase-data";
import { AttendanceStatus, TEAM_ORDER, type SlotCode, type TeamCode } from "@/types/db-enums";
import { parseUnavailableSlots } from "./attendance";

export async function getFirebaseDailyAttendance(date: string) {
  await ensureAnonymousAuth();
  const [staff, attendanceSnapshot] = await Promise.all([
    readStaff(),
    get(ref(firebaseDb, `attendance/${date}`)),
  ]);
  const records = (attendanceSnapshot.val() ?? {}) as Record<string, FirebaseAttendance>;
  return staff
    .filter((member) => member.role === "ASSISTANT")
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

export async function getFirebaseTeamWeights(): Promise<Record<TeamCode, number>> {
  await ensureAnonymousAuth();
  const snapshot = await get(ref(firebaseDb, "teams"));
  const rows = (snapshot.val() ?? {}) as Record<string, { weight?: number }>;
  return Object.fromEntries(TEAM_ORDER.map((team) => [team, rows[team]?.weight ?? 0])) as Record<TeamCode, number>;
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
