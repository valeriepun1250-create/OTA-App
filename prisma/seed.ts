// Task dictionary seed — §2.3
// Default scores: MoCA = 2, AMT/CDT/TED/HP = 1
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TASKS = [
  { code: "MOCA",    name: "MoCA",            category: "COGNITIVE" as const, score: 2, remark: "Cognitive assessment" },
  { code: "AMT_CDT", name: "AMT / AMT + CDT", category: "COGNITIVE" as const, score: 1, remark: "Cognitive screening" },
  { code: "FIT_TED", name: "Fit / Check (TED)", category: "STOCKING" as const, score: 1, remark: "TED stocking measurement/fitting" },
  { code: "FIT_HP",  name: "Fit / Check (HP)",  category: "HEEL_PAD" as const, score: 1, remark: "Heel pad fitting/check" },
];

const TEAMS = [
  { code: "NS"       as const, name: "Neuro Surgery", weight: 3.5 },
  { code: "STROKE"   as const, name: "Stroke",        weight: 4 },
  { code: "SURGICAL" as const, name: "Surgical",      weight: 2 },
  { code: "ORTHO"    as const, name: "Orthopaedic",   weight: 4 },
  { code: "PEDS"     as const, name: "Paediatrics",   weight: 2 },
];

const STAFF = [
  // Schedule admin — has attendance management by default
  { staffNo: "ADM001", name: "Admin", role: "ADMIN" as const, teamCode: null, canManageAttendance: true, defaultStatus: "PRESENT" },
  // Therapists
  { staffNo: "T001", name: "Jamie", role: "THERAPIST" as const, teamCode: "NS" as const, canManageAttendance: true, defaultStatus: "PRESENT" },
  { staffNo: "T002", name: "Taylor", role: "THERAPIST" as const, teamCode: "STROKE" as const, canManageAttendance: true, defaultStatus: "PRESENT" },
  { staffNo: "T003", name: "Morgan", role: "THERAPIST" as const, teamCode: "ORTHO" as const, canManageAttendance: false, defaultStatus: "PRESENT" },
  // Assistants (7: 6 AM + 7 PM = 6 full-time + 1 PM_ONLY)
  { staffNo: "A001", name: "Amy", role: "ASSISTANT" as const, teamCode: "NS"       as const, canManageAttendance: false, defaultStatus: "PRESENT" },
  { staffNo: "A002", name: "Ben", role: "ASSISTANT" as const, teamCode: "STROKE"   as const, canManageAttendance: false, defaultStatus: "PRESENT" },
  { staffNo: "A003", name: "Chris", role: "ASSISTANT" as const, teamCode: "ORTHO"    as const, canManageAttendance: false, defaultStatus: "PRESENT" },
  { staffNo: "A004", name: "Diana", role: "ASSISTANT" as const, teamCode: "PEDS"     as const, canManageAttendance: false, defaultStatus: "PRESENT" },
  { staffNo: "A005", name: "Evan", role: "ASSISTANT" as const, teamCode: "SURGICAL" as const, canManageAttendance: false, defaultStatus: "PRESENT" },
  { staffNo: "A006", name: "Fiona", role: "ASSISTANT" as const, teamCode: "STROKE"   as const, canManageAttendance: false, defaultStatus: "PRESENT" },
  // One assistant defaults to PM only (hospital scheduling rule)
  { staffNo: "A007", name: "Grace", role: "ASSISTANT" as const, teamCode: "ORTHO"    as const, canManageAttendance: false, defaultStatus: "PM_ONLY" },
];

async function main() {
  for (const t of TEAMS) {
    await prisma.team.upsert({ where: { code: t.code }, update: t, create: t });
  }
  for (const t of TASKS) {
    await prisma.taskDictionary.upsert({ where: { code: t.code }, update: t, create: t });
  }
  for (const s of STAFF) {
    const teamId = s.teamCode
      ? (await prisma.team.findUniqueOrThrow({ where: { code: s.teamCode } })).id
      : null;
    const data = {
      name: s.name,
      role: s.role,
      teamId,
      canManageAttendance: s.canManageAttendance,
      defaultStatus: s.defaultStatus,
    };
    await prisma.staff.upsert({
      where: { staffNo: s.staffNo },
      update: data,
      create: { staffNo: s.staffNo, ...data },
    });
  }
  console.log("Seeded:", TEAMS.length, "teams,", TASKS.length, "tasks,", STAFF.length, "staff");
}

main().finally(() => prisma.$disconnect());
