// Attendance → on-duty assistant count per pool (S1_INDEPENDENT / AM / PM)
import { AttendanceStatus, type SessionPool, type SlotCode } from "@/types/db-enums";

export const SLOT_TO_POOL: Record<SlotCode, SessionPool> = {
  S1: "S1_INDEPENDENT",  // Task-oriented, independent completion
  S2: "AM",
  S3: "AM",
  S4: "PM",
  S5: "PM",
};

/** S1/S2-S5 dual-track — S1 is task-oriented, S2-S5 is manpower reservation */
export function isTaskSlot(slot: SlotCode): boolean {
  return slot === "S1";
}

/**
 * Whether attendance status covers a given pool.
 * - LEAVE: full-day leave → neither pool works
 * - AM_ONLY: morning only → covers S1 + AM
 * - PM_ONLY: afternoon only → covers PM only
 * - PRESENT (default): all
 */
export function isOnDutyForPool(status: AttendanceStatus | null, pool: SessionPool): boolean {
  const s = status ?? AttendanceStatus.PRESENT;
  if (s === AttendanceStatus.LEAVE) return false;
  if (pool === "PM") return s === AttendanceStatus.PRESENT || s === AttendanceStatus.PM_ONLY;
  // S1_INDEPENDENT and AM are both in the morning
  return s === AttendanceStatus.PRESENT || s === AttendanceStatus.AM_ONLY;
}

export const ALL_SLOTS: SlotCode[] = ["S1", "S2", "S3", "S4", "S5"];

export function parseUnavailableSlots(note: string | null | undefined): SlotCode[] {
  if (!note) return [];
  try {
    const parsed = JSON.parse(note) as { unavailableSlots?: unknown };
    if (!Array.isArray(parsed.unavailableSlots)) return [];
    return parsed.unavailableSlots.filter((slot): slot is SlotCode =>
      ALL_SLOTS.includes(slot as SlotCode)
    );
  } catch {
    return [];
  }
}

export function encodeUnavailableSlots(slots: SlotCode[]): string | null {
  const unique = ALL_SLOTS.filter((slot) => slots.includes(slot));
  return unique.length > 0 ? JSON.stringify({ unavailableSlots: unique }) : null;
}

export function isAvailableForSlot(
  status: AttendanceStatus | null,
  note: string | null | undefined,
  slot: SlotCode
): boolean {
  const s = status ?? AttendanceStatus.PRESENT;
  if (s === AttendanceStatus.LEAVE) return false;
  if (s === AttendanceStatus.OTHER) {
    return !parseUnavailableSlots(note).includes(slot);
  }
  return isOnDutyForPool(s, SLOT_TO_POOL[slot]);
}

/** Count assistants on duty for a specific pool */
export function countAssistantsOnDuty(
  assistantStatuses: Map<string, AttendanceStatus | null>,
  pool: SessionPool
): number {
  let count = 0;
  for (const status of assistantStatuses.values()) {
    if (isOnDutyForPool(status, pool)) count++;
  }
  return count;
}
