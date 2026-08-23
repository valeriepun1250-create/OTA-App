"use client";

import { get, onValue, ref, type Unsubscribe } from "firebase/database";
import { readAssignments, readStaff } from "./firebase-data";
import { ensureAnonymousAuth, firebaseDb } from "./firebase";
import { isAvailableForSlot, parseUnavailableSlots } from "./attendance";
import { AttendanceStatus, type SlotCode, type TeamCode } from "@/types/db-enums";

const SLOT_TIME: Record<SlotCode, string> = {
  S1: "08:30 – 10:00",
  S2: "10:00 – 11:15",
  S3: "11:15 – 12:30",
  S4: "13:30 – 15:15",
  S5: "15:15 – 17:00",
};

function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function mondayOf(date: string) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
}

export async function getFirebaseAssistantSelector(date: string) {
  const [staff, attendanceSnapshot] = await Promise.all([
    readStaff(),
    get(ref(firebaseDb, `attendance/${date}`)),
  ]);
  const attendance = attendanceSnapshot.val() ?? {};
  return staff.filter((member) => member.role === "ASSISTANT").map((member) => {
    const row = attendance[member.id];
    const status = (row?.status ?? member.defaultStatus) as AttendanceStatus;
    const unavailableSlots = parseUnavailableSlots(row?.note);
    const available = (["S1", "S2", "S3", "S4", "S5"] as SlotCode[]).filter((slot) =>
      isAvailableForSlot(status, JSON.stringify({ unavailableSlots }), slot)
    ).length;
    return {
      ...member,
      todayStatus: status,
      unavailableSlots,
      tier: available === 0 ? "ABSENT" : available < 5 ? "PARTIAL" : "FULL",
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function listenToFirebaseAssistant(
  assistantId: string,
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

export async function getFirebaseAssistantSchedule(assistantId: string, date: string) {
  await ensureAnonymousAuth();
  const [staff, assignments] = await Promise.all([readStaff(), readAssignments(date)]);
  const assistant = staff.find((member) => member.id === assistantId);
  if (!assistant) throw new Error("Assistant not found");
  const s1Tasks = assignments.filter((row) => row.slot === "S1" && row.assistantId === assistantId);
  const teamSchedule = assignments
    .filter((row) => row.assistantId === assistantId && row.slot !== "S1" && row.supportTeam)
    .map((row) => ({ team: row.supportTeam as TeamCode, slots: [row.slot], timeRange: SLOT_TIME[row.slot] }));

  const monday = mondayOf(date);
  const days = await Promise.all(Array.from({ length: 5 }, async (_, index) => {
    const dayDate = addDays(monday, index);
    const [dayAssignments, attendanceSnapshot] = await Promise.all([
      readAssignments(dayDate),
      import("firebase/database").then(({ get, ref }) => get(ref(firebaseDb, `attendance/${dayDate}`))),
    ]);
    const attendance = attendanceSnapshot.val()?.[assistantId];
    return {
      date: dayDate,
      leave: attendance ? { status: attendance.status as AttendanceStatus } : null,
      assignments: dayAssignments.filter((row) => row.assistantId === assistantId).map((row) => ({
        slot: row.slot,
        supportTeam: row.supportTeam as TeamCode | null,
      })),
    };
  }));
  return { assistant, s1Tasks, teamSchedule, weekly: { days } };
}
