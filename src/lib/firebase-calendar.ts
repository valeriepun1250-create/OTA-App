"use client";

import { get, ref, update } from "firebase/database";
import { ensureAnonymousAuth, firebaseDb } from "./firebase";
import { readStaff } from "./firebase-data";
import { readAssignments } from "./firebase-data";
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

export async function getFirebaseCalendarMonth(month: string) {
  await ensureAnonymousAuth();
  const staff = (await readStaff()).filter((member) => member.role === "ASSISTANT");
  const dates = daysInMonth(month);
  const snapshots = await Promise.all(dates.map((date) => get(ref(firebaseDb, `attendance/${date}`))));
  const days = dates.map((date, index) => {
    const records = snapshots[index].val() ?? {};
    return {
      date,
      day: Number(date.slice(-2)),
      weekday: isWeekday(date),
      leaves: staff.flatMap((member) => {
        const record = records[member.id];
        if (!record || record.status === AttendanceStatus.PRESENT) return [];
        const parsed = record.note ? JSON.parse(record.note) : {};
        return [{
          staffId: member.id,
          name: member.name,
          team: member.team as TeamCode | null,
          status: record.status,
          leaveType: parsed.leaveType ?? null,
          leaveDuration: parsed.leaveDuration ?? null,
          unavailableSlots: parsed.unavailableSlots ?? [],
        }];
      }),
    };
  });
  const roster = [];
  for (const date of dates.filter(isWeekday)) {
    const rows = await readAssignments(date);
    const byId = new Map(staff.map((member) => [member.id, member]));
    const board = Object.fromEntries(TEAM_ORDER.map((team) => [team, { S2: [], S3: [], S4: [], S5: [] }])) as Record<string, Record<string, { id: string; name: string; homeTeam: TeamCode | null }[]>>;
    for (const row of rows) {
      if (!row.supportTeam || row.slot === "S1" || !row.assistantId) continue;
      const member = byId.get(row.assistantId);
      if (member) board[row.supportTeam][row.slot].push({ id: member.id, name: member.name, homeTeam: member.team });
    }
    roster.push({ date, board });
  }
  return { assistants: staff.map((member) => ({ id: member.id, name: member.name, team: member.team })), days, roster };
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
