import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { isAvailableForSlot, parseUnavailableSlots } from "@/lib/attendance";
import { TEAM_LABEL, AttendanceStatus, type TeamCode } from "@/types/db-enums";
import { getTodayInHongKong } from "@/lib/date";

export const dynamic = "force-dynamic";

function toDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

type DutyTier = "FULL" | "PARTIAL" | "ABSENT";

function classifyDuty(status: AttendanceStatus, unavailableSlots: string[]): DutyTier {
  if (status === AttendanceStatus.LEAVE) return "ABSENT";
  if (status === AttendanceStatus.OTHER) {
    const note = JSON.stringify({ unavailableSlots });
    const availableCount = (["S1", "S2", "S3", "S4", "S5"] as const).filter((slot) =>
      isAvailableForSlot(status, note, slot)
    ).length;
    if (availableCount === 0) return "ABSENT";
    if (availableCount < 5) return "PARTIAL";
  }
  if (status === AttendanceStatus.AM_ONLY || status === AttendanceStatus.PM_ONLY) {
    return "PARTIAL";
  }
  return "FULL";
}

const TIER_STYLE: Record<DutyTier, string> = {
  FULL: "border-emerald-300 bg-emerald-50/90 text-emerald-900 hover:border-emerald-500",
  PARTIAL: "border-amber-300 bg-amber-50/90 text-amber-900 hover:border-amber-500",
  ABSENT: "border-slate-200 bg-slate-100 text-slate-500 hover:border-slate-300",
};

const TIER_LABEL: Record<DutyTier, string> = {
  FULL: "Full Day",
  PARTIAL: "Half Day",
  ABSENT: "Absent",
};

export default async function AssistantSelectorPage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const dateStr = searchParams.date ?? getTodayInHongKong();
  const date = toDate(dateStr);

  const assistants = await prisma.staff.findMany({
    where: { role: "ASSISTANT", active: true },
    include: { team: true },
    orderBy: { name: "asc" },
  });

  const attendances = await prisma.attendance.findMany({
    where: { date, staffId: { in: assistants.map((a) => a.id) } },
  });
  const attendanceByStaff = new Map(attendances.map((a) => [a.staffId, a]));

  return (
    <main className="app-shell">
      <header className="page-hero">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="badge bg-emerald-100 text-emerald-800">Assistant Workflow</p>
            <h1 className="mt-3 text-2xl font-bold sm:text-3xl">Select Assistant</h1>
            <p className="mt-2 text-sm font-medium text-slate-700">Date: {dateStr}</p>
          </div>
          <Link href="/" className="btn btn-secondary">
            ← Home
          </Link>
        </div>
      </header>

      <section className="panel-soft mb-4 flex flex-wrap gap-2 text-xs sm:text-sm">
        <span className="badge bg-emerald-100 text-emerald-800">
          <span className="mr-1.5 h-2 w-2 rounded-full bg-emerald-500" /> Full day on duty
        </span>
        <span className="badge bg-amber-100 text-amber-800">
          <span className="mr-1.5 h-2 w-2 rounded-full bg-amber-500" /> Half day on duty
        </span>
        <span className="badge bg-slate-200 text-slate-600">
          <span className="mr-1.5 h-2 w-2 rounded-full bg-slate-400" /> Absent
        </span>
      </section>

      <ul className="grid gap-3 sm:grid-cols-2">
        {assistants.map((a) => {
          const attendance = attendanceByStaff.get(a.id);
          const status = (attendance?.status ?? a.defaultStatus) as AttendanceStatus;
          const unavailableSlots = parseUnavailableSlots(attendance?.note);
          const tier = classifyDuty(status, unavailableSlots);
          const teamLabel = a.team?.code ? TEAM_LABEL[a.team.code as TeamCode] : "—";
          return (
            <li key={a.id}>
              <Link
                href={`/assistant/${a.id}?date=${dateStr}`}
                className={`group flex min-h-[84px] items-center justify-between rounded-2xl border p-4 transition ${TIER_STYLE[tier]}`}
                aria-disabled={tier === "ABSENT"}
              >
                <div className="min-w-0">
                  <div className="text-base font-semibold sm:text-lg">{a.name}</div>
                  <div className="text-sm opacity-80">{teamLabel} Team</div>
                </div>
                <span className="badge bg-white/75 text-slate-700 shadow-sm">{TIER_LABEL[tier]}</span>
              </Link>
            </li>
          );
        })}

        {assistants.length === 0 && (
          <li className="panel text-center text-sm text-slate-500 sm:col-span-2">
            No assistants found. Please run `npm run db:seed`.
          </li>
        )}
      </ul>
    </main>
  );
}
