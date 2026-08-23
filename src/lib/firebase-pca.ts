"use client";

import { get, push, ref, update } from "firebase/database";
import { ensureAnonymousAuth, firebaseDb } from "./firebase";
import { readAssignments, readStaff, type FirebaseAssignment } from "./firebase-data";
import { isAvailableForSlot } from "./attendance";
import { autoDistributeS2S5, computePoolAllocation, TEAM_WEIGHTS, type TeamPoolQuota } from "./allocation";
import { TEAM_ORDER, type AttendanceStatus, type SlotCode, type TeamCode } from "@/types/db-enums";

function statusFor(staff: { id: string; defaultStatus: string }, attendance: Record<string, { status?: string; note?: string | null }>) {
  return (attendance[staff.id]?.status ?? staff.defaultStatus) as AttendanceStatus;
}

async function buildInput(date: string) {
  const [staff, assignments, attendanceSnapshot, weightsSnapshot] = await Promise.all([
    readStaff(),
    readAssignments(date),
    get(ref(firebaseDb, `attendance/${date}`)),
    get(ref(firebaseDb, "teams")),
  ]);
  const attendance = attendanceSnapshot.val() ?? {};
  const rows = weightsSnapshot.val() ?? {};
  const weights = Object.fromEntries(TEAM_ORDER.map((team) => [team, rows[team]?.weight ?? TEAM_WEIGHTS[team]])) as Record<TeamCode, number>;
  const s1WardsByAssistant: Record<string, string[]> = {};
  for (const row of assignments) if (row.slot === "S1" && row.assistantId) (s1WardsByAssistant[row.assistantId] ??= []).push(row.ward);
  const input = staff.filter((member) => member.role === "ASSISTANT").map((member) => {
    const status = statusFor(member, attendance);
    const note = attendance[member.id]?.note;
    let unavailableSlots: SlotCode[] = [];
    try { unavailableSlots = JSON.parse(note ?? "{}").unavailableSlots ?? []; } catch { /* ignore malformed prototype note */ }
    return {
      id: member.id,
      homeTeam: member.team,
      s1Wards: s1WardsByAssistant[member.id] ?? [],
      onDutyAM: isAvailableForSlot(status, note, "S2") || isAvailableForSlot(status, note, "S3"),
      onDutyPM: isAvailableForSlot(status, note, "S4") || isAvailableForSlot(status, note, "S5"),
      unavailableSlots,
    };
  });
  return { staff, assignments, weights, input };
}

export async function getFirebasePcaState(date: string) {
  const { staff, assignments, weights, input } = await buildInput(date);
  const amOnDuty = input.reduce((sum, member) => sum + (member.onDutyAM ? (member.unavailableSlots.includes("S2") ? 0 : 0.5) + (member.unavailableSlots.includes("S3") ? 0 : 0.5) : 0), 0);
  const pmOnDuty = input.reduce((sum, member) => sum + (member.onDutyPM ? (member.unavailableSlots.includes("S4") ? 0 : 0.5) + (member.unavailableSlots.includes("S5") ? 0 : 0.5) : 0), 0);
  const board: Record<string, Record<string, { id: string; name: string; homeTeam: TeamCode | null }[]>> = {};
  for (const team of TEAM_ORDER) board[team] = { S2: [], S3: [], S4: [], S5: [] };
  for (const row of assignments) {
    if (!row.supportTeam || !row.assistantId || row.slot === "S1") continue;
    const member = staff.find((candidate) => candidate.id === row.assistantId);
    if (member) board[row.supportTeam][row.slot].push({ id: member.id, name: member.name, homeTeam: member.team });
  }
  return {
    quotas: { am: computePoolAllocation("AM", { assistantsOnDuty: amOnDuty, weights }), pm: computePoolAllocation("PM", { assistantsOnDuty: pmOnDuty, weights }), amOnDuty, pmOnDuty },
    usage: Object.fromEntries(TEAM_ORDER.map((team) => [team, { am: assignments.filter((row) => row.supportTeam === team && (row.slot === "S2" || row.slot === "S3")).length, pm: assignments.filter((row) => row.supportTeam === team && (row.slot === "S4" || row.slot === "S5")).length }])),
    board,
  };
}

export async function generateFirebaseAutoSchedule(date: string) {
  await ensureAnonymousAuth();
  const { input, weights } = await buildInput(date);
  const allocations = autoDistributeS2S5({ assistants: input, weights });
  const existing = await readAssignments(date);
  const changes: Record<string, unknown> = {};
  for (const row of existing) if (row.slot !== "S1") changes[`assignments/${date}/${row.id}`] = null;
  for (const allocation of allocations) {
    const id = push(ref(firebaseDb, `assignments/${date}`)).key!;
    changes[`assignments/${date}/${id}`] = {
      id, date, slot: allocation.slot, pool: allocation.slot === "S2" || allocation.slot === "S3" ? "AM" : "PM",
      therapistId: null, therapistName: null, assistantId: allocation.assistantId, taskId: null,
      content: null, score: 1, supportTeam: allocation.team, specialty: null, ward: "—", cluster: null,
      initial: null, hnPrefix: null, wasOverQuota: false, status: "PENDING", note: null, createdAt: Date.now(), dispatchedAt: Date.now(),
    } satisfies FirebaseAssignment;
  }
  await update(ref(firebaseDb), changes);
  return { count: allocations.length };
}
