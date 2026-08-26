"use client";

import { get, onValue, ref, update, type Unsubscribe } from "firebase/database";
import {
  claimAssignment,
  createAssignment,
  deleteAssignment,
  readAssignments,
  readStaff,
  updateAssignment,
  type FirebaseAssignment,
  type FirebaseStaff,
} from "./firebase-data";
import { ensureAnonymousAuth, firebaseDb } from "./firebase";
import { dispatchTasksByLocation, computeScore, type PendingTask } from "./allocation";
import { isAvailableForSlot, SLOT_TO_POOL } from "./attendance";
import { AttendanceStatus, Role, type S1Specialty } from "@/types/db-enums";

const sevenDays = 7 * 24 * 60 * 60 * 1000;
const RELIEVING_ASSISTANT_NAME = "medical relieving";

function isRelievingAssistant(name: string) {
  return name.trim().toLowerCase() === RELIEVING_ASSISTANT_NAME;
}

function todayParts() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${getPart("year")}-${getPart("month")}-${getPart("day")}`,
    time: `${getPart("hour")}:${getPart("minute")}`,
  };
}

function isExpired(date: string) {
  const now = todayParts();
  return date < now.date || (date === now.date && now.time >= "23:59");
}

function isOnDuty(staff: FirebaseStaff, attendance: Record<string, { status: string; note?: string | null }>) {
  const record = attendance[staff.id];
  const status = (record?.status ?? staff.defaultStatus) as AttendanceStatus;
  return isAvailableForSlot(status, record?.note ?? null, "S1");
}

export async function cleanupFirebaseS1Tasks() {
  await ensureAnonymousAuth();
  const dates = new Set<string>();
  const snapshot = await get(ref(firebaseDb, "assignments"));
  const all = snapshot.val() as Record<string, Record<string, FirebaseAssignment>> | null;
  if (!all) return { deleted: 0 };
  for (const [date, rows] of Object.entries(all)) {
    for (const [id, row] of Object.entries(rows ?? {})) {
      if (row.slot === "S1" && row.createdAt < Date.now() - sevenDays) {
        dates.add(`${date}/${id}`);
      }
    }
  }
  if (dates.size > 0) {
    const changes: Record<string, null> = {};
    for (const key of dates) changes[`assignments/${key}`] = null;
    await update(ref(firebaseDb), changes);
  }
  return { deleted: dates.size };
}

export async function getFirebaseS1Tasks(date: string) {
  const rows = await readAssignments(date);
  const staff = await readStaff();
  const byId = new Map(staff.map((member) => [member.id, member]));
  return rows
    .filter((row) => row.slot === "S1" && row.status !== "CANCELLED")
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((row) => {
      const assistant = row.assistantId ? byId.get(row.assistantId) : null;
      return {
        ...row,
        assistantName: assistant?.name ?? null,
        assistantTeam: assistant?.team ?? null,
        isPending: !row.assistantId,
      };
    });
}

export async function getFirebaseS1Pool(date: string) {
  const [staff, assignments] = await Promise.all([readStaff(), readAssignments(date)]);
  const attendanceSnapshot = await get(ref(firebaseDb, `attendance/${date}`));
  const attendance = (attendanceSnapshot.val() ?? {}) as Record<string, { status: string; note?: string | null }>;
  return staff
    .filter((member) => member.role === Role.ASSISTANT && isOnDuty(member, attendance))
    .map((member) => {
      const own = assignments.filter((row) => row.slot === "S1" && row.assistantId === member.id && row.status !== "CANCELLED");
      return {
        id: member.id,
        name: member.name,
        team: member.team,
        isRelieving: isRelievingAssistant(member.name),
        currentPoints: own.reduce((sum, row) => sum + (row.score ?? 1), 0),
        currentWards: own.map((row) => row.ward),
      };
    })
    .sort((a, b) => a.currentPoints - b.currentPoints || a.name.localeCompare(b.name));
}

export function listenToFirebaseS1(
  date: string,
  onChange: () => void,
  onError?: (error: Error) => void
): Unsubscribe {
  let active = true;
  let unsubscribe: Unsubscribe = () => undefined;
  void ensureAnonymousAuth()
    .then(() => {
      if (!active) return;
      unsubscribe = onValue(
        ref(firebaseDb, `assignments/${date}`),
        () => onChange(),
        (error) => onError?.(error)
      );
    })
    .catch((error) => onError?.(error instanceof Error ? error : new Error("Firebase sign-in failed")));
  return () => {
    active = false;
    unsubscribe();
  };
}

export async function createFirebaseS1Task(args: {
  date: string;
  ward: string;
  initial: string;
  hnPrefix: string;
  therapistName: string;
  specialty: string;
  content: string;
}) {
  await ensureAnonymousAuth();
  if (isExpired(args.date)) throw new Error("S1 tasks are closed after 23:59 Hong Kong time");
  const task = await createAssignment(args.date, {
    date: args.date,
    slot: "S1",
    pool: SLOT_TO_POOL.S1,
    therapistId: null,
    therapistName: args.therapistName,
    assistantId: null,
    taskId: null,
    content: args.content,
    score: computeScore(args.content),
    supportTeam: null,
    specialty: args.specialty as S1Specialty,
    ward: args.ward,
    cluster: null,
    initial: args.initial,
    hnPrefix: args.hnPrefix,
    wasOverQuota: false,
    note: null,
  });
  return task;
}

export async function assignFirebaseS1Task(date: string, assignmentId: string, assistantId: string) {
  const pool = await getFirebaseS1Pool(date);
  if (!pool.some((member) => member.id === assistantId)) throw new Error("Assistant is not on duty for S1");
  const claimed = await claimAssignment(date, assignmentId, assistantId);
  if (!claimed) throw new Error("This task was already assigned by another therapist");
}

export async function dispatchFirebaseS1Tasks(date: string) {
  const [tasks, pool] = await Promise.all([getFirebaseS1Tasks(date), getFirebaseS1Pool(date)]);
  const pending: PendingTask[] = tasks.filter((task) => task.isPending).map((task) => ({
    id: task.id,
    ward: task.ward,
    score: task.score,
    specialty: task.specialty as S1Specialty | null,
  }));
  const plan = dispatchTasksByLocation(
    pending,
    pool.map((member) => ({
      id: member.id,
      currentWards: member.currentWards,
      currentScore: member.currentPoints,
      homeTeam: member.team,
      isRelieving: member.isRelieving,
    }))
  );
  let dispatched = 0;
  for (const item of plan) {
    try {
      if (await claimAssignment(date, item.taskId, item.assistantId)) dispatched++;
    } catch {
      // A concurrent therapist may have claimed this task; leave it assigned.
    }
  }
  return { dispatched };
}

export async function deleteFirebaseS1Task(date: string, assignmentId: string) {
  await deleteAssignment(date, assignmentId);
}

export async function updateFirebaseS1Content(date: string, assignmentId: string, content: string) {
  await updateAssignment(date, assignmentId, { content, score: computeScore(content) });
}
