import Link from "next/link";
import { notFound } from "next/navigation";
import { getAssistantDailySchedule, getAssistantWeeklySchedule } from "@/app/actions/queries";
import { AssignmentStatusToggle } from "@/components/AssignmentStatusToggle";
import { TaskNoteField } from "@/components/TaskNoteField";
import { TEAM_LABEL, type SlotCode, type TeamCode } from "@/types/db-enums";
import { getTodayInHongKong } from "@/lib/date";

export const dynamic = "force-dynamic";

const SLOT_TIME: Record<SlotCode, string> = {
  S1: "08:30 – 10:00",
  S2: "10:00 – 11:15",
  S3: "11:15 – 12:30",
  S4: "13:30 – 15:15",
  S5: "15:15 – 17:00",
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function mondayOf(dateStr: string) {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

export default async function AssistantDashboard({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { date?: string };
}) {
  const dateStr = searchParams.date ?? getTodayInHongKong();

  let data;
  let weekly;
  try {
    [data, weekly] = await Promise.all([
      getAssistantDailySchedule(params.id, dateStr),
      getAssistantWeeklySchedule(params.id, mondayOf(dateStr)),
    ]);
  } catch {
    notFound();
  }

  const { assistant, s1Tasks, teamSchedule } = data;

  return (
    <main className="app-shell max-w-5xl">
      <header className="page-hero sticky top-3 z-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="badge bg-emerald-100 text-emerald-800">Personal Dashboard</p>
            <h1 className="mt-3 text-2xl font-bold sm:text-3xl">{assistant.name}</h1>
            <p className="muted mt-2 text-sm sm:text-base">
              {assistant.team ? TEAM_LABEL[assistant.team as TeamCode] : "—"} · {dateStr}
            </p>
          </div>
          <Link href="/assistant" className="btn btn-secondary">
            ← Select Assistant
          </Link>
        </div>
      </header>

      <section className="mb-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-semibold">
            <span className="badge bg-amber-100 text-amber-800">S1</span>
            <span className="ml-2">Independent Tasks</span>
          </h2>
          <span className="text-sm text-slate-500">{SLOT_TIME.S1}</span>
        </div>

        {s1Tasks.length === 0 ? (
          <p className="panel text-center text-base text-slate-500">No S1 tasks today</p>
        ) : (
          <ul className="space-y-3">
            {s1Tasks.map((t) => (
              <li key={t.id} className="panel">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-base font-semibold sm:text-lg">
                      {t.content ?? t.task?.name ?? "(Not specified)"}
                    </div>
                    <div className="muted mt-1 text-sm">
                      Ward {t.ward}
                      {t.initial && <> · {t.initial}</>}
                      {t.hnPrefix && <> · HN {t.hnPrefix}</>}
                      <> · {t.specialty ?? "Medical"}</>
                      <> · {t.score ?? 1} pts</>
                    </div>
                    {t.therapistName && <div className="mt-0.5 text-sm text-slate-400">by {t.therapistName}</div>}
                  </div>
                  <AssignmentStatusToggle assignmentId={t.id} current={t.status as never} />
                </div>
                <TaskNoteField assignmentId={t.id} initial={t.note} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">
          <span className="badge bg-teal-100 text-teal-800">S2-S5</span>
          <span className="ml-2">Team Support</span>
        </h2>

        {teamSchedule.length === 0 ? (
          <p className="panel text-center text-base text-slate-500">
            Schedule not yet generated. Ask admin to run Auto-generate Schedule.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {teamSchedule.map((b, i) => (
              <li
                key={i}
                className="rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-4"
              >
                <div className="font-mono text-base font-semibold text-teal-900">{b.timeRange}</div>
                <div className="mt-1 text-sm text-slate-700">
                  Support <strong>{b.team ? TEAM_LABEL[b.team as TeamCode] : "—"}</strong> Team
                </div>
                <div className="mt-1 text-xs text-slate-500">{b.slots.join(" + ")}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-semibold">Weekly Schedule</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-sm text-slate-500">{mondayOf(dateStr)} to {weekly.days[4]?.date}</span>
            <span className="badge bg-emerald-100 text-emerald-800">Home team</span>
            <span className="badge bg-slate-100 text-slate-700">Cross-team</span>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          {weekly.days.map((day, index) => {
            const isLeave = day.leave && day.leave.status !== "PRESENT";
            return (
              <div key={day.date} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold uppercase text-slate-400">
                      {WEEKDAY_LABELS[index]}
                    </div>
                    <div className="font-mono text-sm font-semibold">{day.date.slice(5)}</div>
                  </div>
                  {isLeave && <span className="badge bg-rose-100 text-rose-700">Leave</span>}
                </div>
                <div className="mt-3 space-y-1.5">
                  {(["S2", "S3", "S4", "S5"] as SlotCode[]).map((slot) => {
                    const assignment = day.assignments.find((a) => a.slot === slot);
                    const isHomeTeam =
                      !!assignment?.supportTeam && assignment.supportTeam === assistant.team;
                    return (
                      <div
                        key={slot}
                        className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs ${
                          assignment
                            ? isHomeTeam
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-100 text-slate-700"
                            : "bg-slate-50 text-slate-400"
                        }`}
                      >
                        <span className="font-mono font-semibold">{slot}</span>
                        <span className="truncate font-semibold">
                          {assignment?.supportTeam ? TEAM_LABEL[assignment.supportTeam as TeamCode] : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
