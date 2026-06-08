"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { generateMonthlyAutoSchedule, setCalendarLeave } from "@/app/actions/mutations";
import { TEAM_LABEL, TEAM_ORDER, type SlotCode, type TeamCode } from "@/types/db-enums";
import type { LeaveDuration, LeaveType } from "@/lib/attendance";

type Assistant = { id: string; name: string; team: TeamCode | null };
type LeaveCell = {
  staffId: string;
  name: string;
  team: TeamCode | null;
  status: string;
  leaveType: string | null;
  leaveDuration: string | null;
  unavailableSlots: SlotCode[];
};
type CalendarDay = {
  date: string;
  day: number;
  weekday: boolean;
  leaves: LeaveCell[];
};
type RosterPerson = { id: string; name: string; homeTeam: TeamCode | null };
type RosterDay = {
  date: string;
  board: Record<string, Record<string, RosterPerson[]>>;
};

const LEAVE_OPTIONS: { value: LeaveType; label: string }[] = [
  { value: "AL", label: "AL" },
  { value: "SICK_LEAVE", label: "Sick Leave" },
  { value: "FOLLOW_UP", label: "Follow Up" },
];

const DURATION_OPTIONS: { value: LeaveDuration; label: string }[] = [
  { value: "FULL_DAY", label: "Full day" },
  { value: "AM", label: "AM" },
  { value: "PM", label: "PM" },
  { value: "CUSTOM", label: "Manual S1-S5" },
];

const SLOT_OPTIONS: Exclude<SlotCode, "S1">[] = ["S2", "S3", "S4", "S5"];
const SLOT_TIME: Record<Exclude<SlotCode, "S1">, string> = {
  S2: "10:00-11:15",
  S3: "11:15-12:30",
  S4: "13:30-15:15",
  S5: "15:15-17:00",
};

const TEAM_TAG_CLASS: Record<TeamCode, string> = {
  NS: "border-teal-200 bg-teal-50 text-teal-800",
  STROKE: "border-violet-200 bg-violet-50 text-violet-800",
  SURGICAL: "border-amber-200 bg-amber-50 text-amber-800",
  ORTHO: "border-sky-200 bg-sky-50 text-sky-800",
  PEDS: "border-rose-200 bg-rose-50 text-rose-800",
};

function leaveLabel(leave: LeaveCell) {
  const type = LEAVE_OPTIONS.find((o) => o.value === leave.leaveType)?.label ?? "Leave";
  const duration = DURATION_OPTIONS.find((o) => o.value === leave.leaveDuration)?.label;
  const slots = leave.unavailableSlots.length > 0 ? leave.unavailableSlots.join(",") : "";
  return [type, duration ?? slots].filter(Boolean).join(" · ");
}

function weekdayName(date: string) {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-HK", { weekday: "short" });
}

export function CalendarRosterClient({
  monthStr,
  canEdit,
  calendar,
  roster,
}: {
  monthStr: string;
  canEdit: boolean;
  calendar: { assistants: Assistant[]; days: CalendarDay[] };
  roster: RosterDay[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedDate, setSelectedDate] = useState(
    calendar.days.find((d) => d.weekday)?.date ?? `${monthStr}-01`
  );
  const [endDate, setEndDate] = useState(
    calendar.days.find((d) => d.weekday)?.date ?? `${monthStr}-01`
  );
  const [staffId, setStaffId] = useState(calendar.assistants[0]?.id ?? "");
  const [leaveType, setLeaveType] = useState<LeaveType>("AL");
  const [duration, setDuration] = useState<LeaveDuration>("FULL_DAY");
  const [slots, setSlots] = useState<SlotCode[]>([]);

  const selectedDay = useMemo(
    () => calendar.days.find((d) => d.date === selectedDate),
    [calendar.days, selectedDate]
  );

  const monthLeaves = calendar.days.reduce((sum, day) => sum + day.leaves.length, 0);

  const toggleSlot = (slot: SlotCode) => {
    setSlots((current) =>
      current.includes(slot) ? current.filter((s) => s !== slot) : [...current, slot]
    );
  };

  const handleSaveLeave = () => {
    if (!staffId || endDate < selectedDate || (duration === "CUSTOM" && slots.length === 0)) return;
    startTransition(async () => {
      await setCalendarLeave({
        dateStr: selectedDate,
        endDateStr: endDate,
        staffId,
        leaveType,
        duration,
        unavailableSlots: duration === "CUSTOM" ? slots : undefined,
      });
      router.refresh();
    });
  };

  const handleGenerateMonth = () => {
    if (!confirm(`Generate S2-S5 roster for all weekdays in ${monthStr}? Existing S2-S5 rows in this month will be overwritten.`)) {
      return;
    }
    startTransition(async () => {
      await generateMonthlyAutoSchedule(monthStr);
      router.refresh();
    });
  };

  return (
    <main className="app-shell max-w-7xl">
      <header className="page-hero">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="badge bg-cyan-100 text-cyan-800">Core Area</p>
            <h1 className="mt-3 text-2xl font-bold sm:text-3xl">Calendar and Roster</h1>
            <p className="muted mt-2 text-sm">{monthLeaves} leave item(s) in {monthStr}</p>
          </div>
          <Link href="/" className="btn btn-secondary">← Home</Link>
        </div>
      </header>

      <section className="panel">
        <div className="grid gap-4 md:grid-cols-[240px_1fr_auto] md:items-end">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Month</span>
            <input
              type="month"
              value={monthStr}
              onChange={(e) => router.push(`/calendar?month=${e.target.value}`)}
              className="input-base"
            />
          </label>
          <div className="text-sm text-slate-600">
            Calendar leave records drive generated S2-S5 roster for Monday to Friday.
          </div>
          <button onClick={handleGenerateMonth} disabled={pending || !canEdit} className="btn btn-primary">
            {pending ? "Generating..." : "Generate Month Roster"}
          </button>
        </div>
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="panel">
          <h2 className="text-lg font-semibold">Leave Calendar</h2>
          <div className="mt-4 grid grid-cols-7 gap-2 text-center text-xs font-semibold text-slate-500">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d}>{d}</div>)}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-2">
            {calendar.days.map((day, index) => {
              const firstOffset = index === 0 ? (new Date(`${day.date}T00:00:00.000Z`).getUTCDay() + 6) % 7 : 0;
              return (
                <button
                  key={day.date}
                  onClick={() => {
                    setSelectedDate(day.date);
                    setEndDate(day.date);
                  }}
                  style={{ gridColumnStart: index === 0 ? firstOffset + 1 : undefined }}
                  className={`min-h-[112px] rounded-lg border p-2 text-left transition ${
                    selectedDate === day.date
                      ? "border-cyan-500 bg-cyan-50"
                      : day.weekday
                        ? "border-slate-200 bg-white hover:bg-slate-50"
                        : "border-slate-100 bg-slate-50 text-slate-400"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{day.day}</span>
                    {day.leaves.length > 0 && (
                      <span className="badge bg-rose-100 text-rose-700">{day.leaves.length}</span>
                    )}
                  </div>
                  <div className="mt-2 space-y-1">
                    {day.leaves.slice(0, 3).map((leave) => (
                      <div
                        key={`${leave.staffId}-${leave.leaveDuration}`}
                        className={`truncate rounded border px-1.5 py-1 text-[11px] ${
                          leave.team ? TEAM_TAG_CLASS[leave.team] : "border-slate-200 bg-white text-slate-700"
                        }`}
                      >
                        <span className="font-semibold">{leave.team ? TEAM_LABEL[leave.team] : "—"}</span>
                        {" · "}
                        {leave.name} · {leaveLabel(leave)}
                      </div>
                    ))}
                    {day.leaves.length > 3 && <div className="text-[11px] text-slate-400">+{day.leaves.length - 3} more</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="panel">
          <h2 className="text-lg font-semibold">Edit Leave</h2>
          <p className="mt-1 text-sm text-slate-500">
            {selectedDate === endDate ? selectedDate : `${selectedDate} to ${endDate}`}
          </p>
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">From</span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => {
                    setSelectedDate(e.target.value);
                    if (endDate < e.target.value) setEndDate(e.target.value);
                  }}
                  className="input-base"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">To</span>
                <input
                  type="date"
                  value={endDate}
                  min={selectedDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="input-base"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Assistant</span>
              <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className="input-base">
                {calendar.assistants.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.team ? TEAM_LABEL[a.team] : "—"})</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Leave Type</span>
              <select value={leaveType} onChange={(e) => setLeaveType(e.target.value as LeaveType)} className="input-base">
                {LEAVE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Duration</span>
              <select value={duration} onChange={(e) => setDuration(e.target.value as LeaveDuration)} className="input-base">
                {DURATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            {duration === "CUSTOM" && (
              <div>
                <span className="text-xs font-semibold text-slate-600">Absent Slots</span>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(["S1", "S2", "S3", "S4", "S5"] as SlotCode[]).map((slot) => (
                    <button
                      key={slot}
                      onClick={() => toggleSlot(slot)}
                      className={`rounded-md border px-2 py-1 text-xs ${
                        slots.includes(slot)
                          ? "border-orange-500 bg-orange-100 text-orange-800"
                          : "border-slate-200 bg-white text-slate-600"
                      }`}
                    >
                      {slot}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button
              onClick={handleSaveLeave}
              disabled={!canEdit || pending || !staffId || endDate < selectedDate || (duration === "CUSTOM" && slots.length === 0)}
              className="btn btn-primary w-full"
            >
              {selectedDate === endDate ? "Save Leave" : "Save Leave Range"}
            </button>
          </div>

          <div className="mt-5 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold">Selected Day</h3>
            <div className="mt-2 space-y-2">
              {(selectedDay?.leaves ?? []).length === 0 ? (
                <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">No leave recorded.</p>
              ) : (
                selectedDay?.leaves.map((leave) => (
                  <div
                    key={leave.staffId}
                    className={`rounded-lg border p-3 text-sm ${
                      leave.team ? TEAM_TAG_CLASS[leave.team] : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{leave.name}</span>
                      <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold">
                        {leave.team ? TEAM_LABEL[leave.team] : "—"}
                      </span>
                    </div>
                    <div className="text-slate-500">{leaveLabel(leave)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </section>

      <section className="mt-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-semibold">Monthly S2-S5 Roster</h2>
          <span className="text-sm text-slate-500">Weekdays only</span>
        </div>
        <div className="space-y-4">
          {roster.map((day) => (
            <div key={day.date} className="table-wrap">
              <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold">
                {day.date} · {weekdayName(day.date)}
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Team</th>
                    {SLOT_OPTIONS.map((slot) => (
                      <th key={slot}>
                        <div>{slot}</div>
                        <div className="font-mono text-[10px] normal-case text-slate-400">{SLOT_TIME[slot]}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TEAM_ORDER.map((team) => (
                    <tr key={team}>
                      <td className="font-semibold">{TEAM_LABEL[team]}</td>
                      {SLOT_OPTIONS.map((slot) => {
                        const list = day.board[team]?.[slot] ?? [];
                        return (
                          <td key={slot}>
                            {list.length === 0 ? (
                              <span className="text-xs text-slate-300">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {list.map((person) => (
                                  <span
                                    key={person.id}
                                    className={`badge ${
                                      person.homeTeam === team
                                        ? "bg-emerald-100 text-emerald-800"
                                        : "bg-slate-100 text-slate-700"
                                    }`}
                                  >
                                    {person.name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
