"use client";

import {
  get,
  onValue,
  push,
  ref,
  remove,
  runTransaction,
  set,
  update,
  type DataSnapshot,
  type Unsubscribe,
} from "firebase/database";
import { ensureAnonymousAuth, firebaseDb } from "./firebase";
import type { AttendanceStatus, AssignmentStatus, SlotCode, TeamCode } from "@/types/db-enums";

export type FirebaseStaff = {
  id: string;
  staffNo: string;
  name: string;
  role: string;
  team: TeamCode | null;
  active: boolean;
  canManageAttendance: boolean;
  defaultStatus: AttendanceStatus;
};

export type FirebaseAttendance = {
  status: AttendanceStatus;
  note: string | null;
};

export type FirebaseAssignment = {
  id: string;
  date: string;
  slot: SlotCode;
  pool: string;
  therapistId: string | null;
  therapistName: string | null;
  assistantId: string | null;
  taskId: string | null;
  content: string | null;
  score: number;
  supportTeam: TeamCode | null;
  specialty: string | null;
  ward: string;
  cluster: string | null;
  initial: string | null;
  hnPrefix: string | null;
  wasOverQuota: boolean;
  status: AssignmentStatus;
  note: string | null;
  createdAt: number;
  dispatchedAt: number | null;
};

const path = {
  staff: "staff",
  teams: "teams",
  attendance: (date: string) => `attendance/${date}`,
  assignments: (date: string) => `assignments/${date}`,
};

function objectValues<T>(snapshot: DataSnapshot): T[] {
  const value = snapshot.val();
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).map(([id, row]) => ({ id, ...(row as object) }) as T);
}

export async function readStaff(): Promise<FirebaseStaff[]> {
  await ensureAnonymousAuth();
  await ensureFirebasePrototypeSeed();
  const snapshot = await get(ref(firebaseDb, path.staff));
  return objectValues<FirebaseStaff>(snapshot).filter((staff) => staff.active !== false);
}

export async function readAttendance(date: string): Promise<Record<string, FirebaseAttendance>> {
  await ensureAnonymousAuth();
  return (await get(ref(firebaseDb, path.attendance(date)))).val() ?? {};
}

export async function readAssignments(date: string): Promise<FirebaseAssignment[]> {
  await ensureAnonymousAuth();
  return objectValues<FirebaseAssignment>(await get(ref(firebaseDb, path.assignments(date))));
}

export function listenToAssignments(
  date: string,
  onChange: (assignments: FirebaseAssignment[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const assignmentsRef = ref(firebaseDb, path.assignments(date));
  return onValue(
    assignmentsRef,
    (snapshot) => onChange(objectValues<FirebaseAssignment>(snapshot)),
    (error) => onError?.(error)
  );
}

export async function createAssignment(
  date: string,
  input: Omit<FirebaseAssignment, "id" | "createdAt" | "dispatchedAt" | "status">
) {
  await ensureAnonymousAuth();
  const assignmentRef = push(ref(firebaseDb, path.assignments(date)));
  const assignment: FirebaseAssignment = {
    ...input,
    id: assignmentRef.key!,
    status: "PENDING",
    createdAt: Date.now(),
    dispatchedAt: null,
  };
  await set(assignmentRef, assignment);
  return assignment;
}

export async function updateAssignment(
  date: string,
  assignmentId: string,
  changes: Partial<FirebaseAssignment>
) {
  await ensureAnonymousAuth();
  await update(ref(firebaseDb, `${path.assignments(date)}/${assignmentId}`), changes);
}

export async function deleteAssignment(date: string, assignmentId: string) {
  await ensureAnonymousAuth();
  await remove(ref(firebaseDb, `${path.assignments(date)}/${assignmentId}`));
}

/** Atomically claim an unassigned task so two therapists cannot assign it twice. */
export async function claimAssignment(
  date: string,
  assignmentId: string,
  assistantId: string
): Promise<boolean> {
  await ensureAnonymousAuth();
  const taskRef = ref(firebaseDb, `${path.assignments(date)}/${assignmentId}`);
  const result = await runTransaction(taskRef, (current) => {
    if (!current || current.assistantId || current.status === "CANCELLED") return;
    return { ...current, assistantId, dispatchedAt: Date.now() };
  });
  return result.committed;
}

export async function setDailyAttendance(
  date: string,
  staffId: string,
  attendance: FirebaseAttendance
) {
  await ensureAnonymousAuth();
  await set(ref(firebaseDb, `${path.attendance(date)}/${staffId}`), attendance);
}

export async function updateStaff(staffId: string, changes: Partial<FirebaseStaff>) {
  await ensureAnonymousAuth();
  await update(ref(firebaseDb, `${path.staff}/${staffId}`), changes);
}

/** Seed the prototype database once from the original local demo roster. */
export async function ensureFirebasePrototypeSeed() {
  await ensureAnonymousAuth();
  const staffSnapshot = await get(ref(firebaseDb, path.staff));
  if (staffSnapshot.exists()) return false;

  const teams: Record<string, { name: string; weight: number }> = {
    MEDICAL: { name: "Medical", weight: 0 },
    NS: { name: "Neuro Surgery", weight: 3.5 },
    STROKE: { name: "Stroke", weight: 4 },
    SURGICAL: { name: "Surgical", weight: 2 },
    ORTHO: { name: "Orthopaedic", weight: 4 },
    PEDS: { name: "Paediatrics", weight: 2 },
  };
  const people = [
    ["ADM001", "Admin", "ADMIN", null, true, "PRESENT"],
    ["T001", "Jamie", "THERAPIST", "NS", true, "PRESENT"],
    ["T002", "Taylor", "THERAPIST", "STROKE", true, "PRESENT"],
    ["T003", "Morgan", "THERAPIST", "ORTHO", false, "PRESENT"],
    ["A001", "Amy", "ASSISTANT", "NS", false, "PRESENT"],
    ["A002", "Ben", "ASSISTANT", "STROKE", false, "PRESENT"],
    ["A003", "Chris", "ASSISTANT", "ORTHO", false, "PRESENT"],
    ["A004", "Diana", "ASSISTANT", "PEDS", false, "PRESENT"],
    ["A005", "Evan", "ASSISTANT", "SURGICAL", false, "PRESENT"],
    ["A006", "Fiona", "ASSISTANT", "STROKE", false, "PRESENT"],
    ["A007", "Grace", "ASSISTANT", "ORTHO", false, "PM_ONLY"],
  ] as const;
  const changes: Record<string, unknown> = {};
  for (const [staffNo, name, role, team, canManageAttendance, defaultStatus] of people) {
    const id = staffNo.toLowerCase();
    changes[`staff/${id}`] = {
      id,
      staffNo,
      name,
      role,
      team,
      active: true,
      canManageAttendance,
      defaultStatus,
    };
  }
  for (const [code, data] of Object.entries(teams)) changes[`teams/${code}`] = data;
  await update(ref(firebaseDb), changes);
  return true;
}
