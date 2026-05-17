// SQLite does not support enum, replace Prisma-generated enums with TS constants + string union types.
// When migrating to Postgres, restore enums in schema and delete this file.

export const Role = {
  THERAPIST: "THERAPIST",
  ASSISTANT: "ASSISTANT",
  ADMIN: "ADMIN",
} as const;
export type Role = typeof Role[keyof typeof Role];

export const TeamCode = {
  NS: "NS",
  STROKE: "STROKE",
  SURGICAL: "SURGICAL",
  ORTHO: "ORTHO",
  PEDS: "PEDS",
} as const;
export type TeamCode = typeof TeamCode[keyof typeof TeamCode];

/** UI display name — internal code PEDS displayed as Paedi */
export const TEAM_LABEL: Record<TeamCode, string> = {
  NS: "NS",
  STROKE: "Stroke",
  SURGICAL: "Surgical",
  ORTHO: "Ortho",
  PEDS: "Paedi",
};

export const TEAM_ORDER: TeamCode[] = ["NS", "STROKE", "SURGICAL", "ORTHO", "PEDS"];

export const AttendanceStatus = {
  PRESENT: "PRESENT",
  LEAVE: "LEAVE",
  AM_ONLY: "AM_ONLY",
  PM_ONLY: "PM_ONLY",
  OTHER: "OTHER",
} as const;
export type AttendanceStatus = typeof AttendanceStatus[keyof typeof AttendanceStatus];

export const TaskCategory = {
  COGNITIVE: "COGNITIVE",
  STOCKING: "STOCKING",
  HEEL_PAD: "HEEL_PAD",
  OTHER: "OTHER",
} as const;
export type TaskCategory = typeof TaskCategory[keyof typeof TaskCategory];

export const SlotCode = {
  S1: "S1", S2: "S2", S3: "S3", S4: "S4", S5: "S5",
} as const;
export type SlotCode = typeof SlotCode[keyof typeof SlotCode];

export const SessionPool = {
  S1_INDEPENDENT: "S1_INDEPENDENT",
  AM: "AM",
  PM: "PM",
} as const;
export type SessionPool = typeof SessionPool[keyof typeof SessionPool];

export const WardCluster = {
  CLUSTER_1: "CLUSTER_1",
  CLUSTER_2: "CLUSTER_2",
} as const;
export type WardCluster = typeof WardCluster[keyof typeof WardCluster];

export const AssignmentStatus = {
  PENDING: "PENDING",
  IN_PROGRESS: "IN_PROGRESS",
  DONE: "DONE",
  CANCELLED: "CANCELLED",
} as const;
export type AssignmentStatus = typeof AssignmentStatus[keyof typeof AssignmentStatus];
