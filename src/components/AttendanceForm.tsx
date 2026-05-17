"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setAttendanceBatch,
  updateTeamWeights,
  addAssistant,
  updateAssistant,
  deactivateAssistant,
} from "@/app/actions/mutations";
import {
  AttendanceStatus,
  SlotCode,
  TeamCode,
  TEAM_ORDER,
  TEAM_LABEL,
} from "@/types/db-enums";

interface AssistantRow {
  id: string;
  name: string;
  team: string | null;
  defaultStatus: AttendanceStatus;
  todayStatus: AttendanceStatus;
  unavailableSlots: SlotCode[];
}

interface Props {
  initialDate: string;
  initialAssistants: AssistantRow[];
  initialWeights: Record<TeamCode, number>;
}

const STATUS_OPTIONS: { value: AttendanceStatus; label: string }[] = [
  { value: "PRESENT", label: "On Duty" },
  { value: "AM_ONLY", label: "AM Only" },
  { value: "PM_ONLY", label: "PM Only" },
  { value: "LEAVE", label: "Absent" },
  { value: "OTHER", label: "Other" },
];

const DEFAULT_STATUS_OPTIONS = STATUS_OPTIONS.filter((option) => option.value !== "OTHER");

const STATUS_COLOR: Record<AttendanceStatus, string> = {
  PRESENT: "bg-emerald-100 text-emerald-700",
  AM_ONLY: "bg-sky-100 text-sky-700",
  PM_ONLY: "bg-indigo-100 text-indigo-700",
  LEAVE: "bg-rose-100 text-rose-700",
  OTHER: "bg-orange-100 text-orange-700",
};

const SLOT_OPTIONS: SlotCode[] = ["S1", "S2", "S3", "S4", "S5"];

export function AttendanceForm({
  initialDate,
  initialAssistants,
  initialWeights,
}: Props) {
  const router = useRouter();
  const [dateStr, setDateStr] = useState(initialDate);
  const [pending, startTransition] = useTransition();

  const [draft, setDraft] = useState<Record<string, AttendanceStatus>>(() =>
    Object.fromEntries(initialAssistants.map((a) => [a.id, a.todayStatus]))
  );
  const [unavailableDraft, setUnavailableDraft] = useState<Record<string, SlotCode[]>>(() =>
    Object.fromEntries(initialAssistants.map((a) => [a.id, a.unavailableSlots ?? []]))
  );

  const [weights, setWeights] = useState<Record<TeamCode, number>>(initialWeights);
  const weightsDirty = TEAM_ORDER.some((t) => weights[t] !== initialWeights[t]);
  const totalWeight = TEAM_ORDER.reduce((sum, t) => sum + (weights[t] || 0), 0);

  const [newName, setNewName] = useState("");
  const [newTeam, setNewTeam] = useState<TeamCode>("NS");
  const [newDefault, setNewDefault] = useState<AttendanceStatus>("PRESENT");

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const dirtyAttendanceCount = useMemo(() => {
    return initialAssistants.filter((a) => {
      const statusDirty = draft[a.id] !== a.todayStatus;
      const before = [...(a.unavailableSlots ?? [])].sort().join(",");
      const after = [...(unavailableDraft[a.id] ?? [])].sort().join(",");
      return statusDirty || before !== after;
    }).length;
  }, [draft, unavailableDraft, initialAssistants]);

  const handleDateChange = (newDate: string) => {
    router.push(`/attendance?date=${newDate}`);
    setDateStr(newDate);
  };

  const handleSubmitAttendance = () => {
    startTransition(async () => {
      const updates = Object.entries(draft).map(([staffId, status]) => ({
        staffId,
        status,
        unavailableSlots: status === "OTHER" ? unavailableDraft[staffId] ?? [] : [],
      }));
      await setAttendanceBatch({ dateStr, updates });
      router.refresh();
    });
  };

  const handleSaveWeights = () => {
    startTransition(async () => {
      await updateTeamWeights(weights);
      router.refresh();
    });
  };

  const handleAddAssistant = () => {
    if (!newName.trim()) return;
    startTransition(async () => {
      await addAssistant({ name: newName.trim(), teamCode: newTeam, defaultStatus: newDefault });
      setNewName("");
      router.refresh();
    });
  };

  const handleSaveEdit = (id: string) => {
    if (!editName.trim()) return;
    startTransition(async () => {
      await updateAssistant({ id, name: editName.trim() });
      setEditId(null);
      router.refresh();
    });
  };

  const handleDeactivate = (id: string, name: string) => {
    if (
      !confirm(
        `Deactivate ${name}? Historical assignment records will be kept, but they will not appear in future scheduling.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      await deactivateAssistant(id);
      router.refresh();
    });
  };

  const handleTeamChange = (id: string, code: TeamCode) => {
    startTransition(async () => {
      await updateAssistant({ id, teamCode: code });
      router.refresh();
    });
  };

  const handleDefaultStatusChange = (id: string, status: AttendanceStatus) => {
    startTransition(async () => {
      await updateAssistant({ id, defaultStatus: status });
      router.refresh();
    });
  };

  const setTodayStatus = (id: string, status: AttendanceStatus) => {
    setDraft((d) => ({ ...d, [id]: status }));
    if (status !== "OTHER") {
      setUnavailableDraft((d) => ({ ...d, [id]: [] }));
    }
  };

  const toggleUnavailableSlot = (id: string, slot: SlotCode) => {
    setUnavailableDraft((d) => {
      const current = d[id] ?? [];
      const next = current.includes(slot)
        ? current.filter((s) => s !== slot)
        : [...current, slot];
      return { ...d, [id]: next };
    });
  };

  return (
    <main className="app-shell">
      <header className="page-hero">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="badge bg-amber-100 text-amber-800">Manpower Setup</p>
            <h1 className="mt-3 text-2xl font-bold sm:text-3xl">Attendance Management</h1>
          </div>
          <button onClick={() => router.push("/")} className="btn btn-secondary">
            ← Home
          </button>
        </div>
      </header>

      <section className="panel">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Team Therapist Count (Allocation Weight)</h2>
          </div>
          <span className="badge bg-slate-100 text-slate-700">Total Weight {totalWeight}</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          {TEAM_ORDER.map((code) => (
            <label key={code} className="block">
              <span className="text-xs font-semibold text-slate-600">{TEAM_LABEL[code]}</span>
              <input
                type="number"
                step="0.5"
                min="0"
                value={weights[code]}
                onChange={(e) => setWeights((w) => ({ ...w, [code]: parseFloat(e.target.value) || 0 }))}
                className="input-base"
              />
            </label>
          ))}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={handleSaveWeights}
            disabled={!weightsDirty || pending}
            className="btn btn-primary"
          >
            Save Weights
          </button>
        </div>
      </section>

      <section className="mt-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-semibold">Today's Attendance</h2>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Date</span>
            <input
              type="date"
              value={dateStr}
              onChange={(e) => handleDateChange(e.target.value)}
              className="input-base mt-1"
            />
          </label>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Team</th>
                <th>Default</th>
                <th>Today</th>
                <th className="w-56">Change Today</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {initialAssistants.map((a) => {
                const current = draft[a.id];
                const dirty = current !== a.todayStatus;
                const isEditing = editId === a.id;
                return (
                  <tr key={a.id}>
                    <td className="font-medium">
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            autoFocus
                            className="input-base mt-0 max-w-[160px] px-2 py-1"
                          />
                          <button
                            onClick={() => handleSaveEdit(a.id)}
                            className="btn btn-primary min-h-[34px] px-2.5 py-1 text-xs"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditId(null)}
                            className="btn btn-secondary min-h-[34px] px-2.5 py-1 text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          {a.name}
                          {dirty && <span className="ml-1 text-xs text-amber-600">●</span>}
                          <button
                            onClick={() => {
                              setEditId(a.id);
                              setEditName(a.name);
                            }}
                            className="ml-2 text-xs text-slate-400 hover:text-slate-700"
                            title="Edit name"
                          >
                            ✏️
                          </button>
                        </>
                      )}
                    </td>
                    <td>
                      <select
                        value={(a.team as TeamCode) ?? "NS"}
                        onChange={(e) => handleTeamChange(a.id, e.target.value as TeamCode)}
                        className="input-base mt-0 px-2 py-1.5 text-xs"
                      >
                        {TEAM_ORDER.map((c) => (
                          <option key={c} value={c}>
                            {TEAM_LABEL[c]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={a.defaultStatus}
                        onChange={(e) => handleDefaultStatusChange(a.id, e.target.value as AttendanceStatus)}
                        className="input-base mt-0 px-2 py-1.5 text-xs"
                        title="Default attendance status"
                      >
                        {STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span className={`badge ${STATUS_COLOR[current]}`}>
                        {STATUS_OPTIONS.find((o) => o.value === current)?.label}
                      </span>
                      {current === "OTHER" && (unavailableDraft[a.id]?.length ?? 0) > 0 && (
                        <div className="mt-1 text-[11px] text-slate-500">
                          Absent: {unavailableDraft[a.id].join(", ")}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {STATUS_OPTIONS.map((o) => (
                          <button
                            key={o.value}
                            onClick={() => setTodayStatus(a.id, o.value)}
                            className={`rounded-lg border px-2 py-1 text-xs transition ${
                              current === o.value
                                ? "border-slate-800 bg-slate-800 text-white"
                                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                      {current === "OTHER" && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {SLOT_OPTIONS.map((slot) => {
                            const selected = unavailableDraft[a.id]?.includes(slot) ?? false;
                            return (
                              <button
                                key={slot}
                                onClick={() => toggleUnavailableSlot(a.id, slot)}
                                className={`rounded-md border px-2 py-0.5 text-[11px] transition ${
                                  selected
                                    ? "border-orange-500 bg-orange-100 text-orange-800"
                                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                                }`}
                              >
                                {slot}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td>
                      <button
                        onClick={() => handleDeactivate(a.id, a.name)}
                        className="inline-flex h-5 w-5 items-center justify-center text-rose-500 hover:text-rose-700"
                        title="Deactivate (keep history)"
                        aria-label={`Deactivate ${a.name}`}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                          className="h-4 w-4 fill-current"
                        >
                          <path d="M9 3h6l1 2h4v3H4V5h4l1-2Zm-3 6h12l-.8 11.2A2 2 0 0 1 15.2 22H8.8a2 2 0 0 1-2-1.8L6 9Zm3 2v8h2v-8H9Zm4 0v8h2v-8h-2Z" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel mt-5">
        <h2 className="text-base font-semibold">Add Assistant</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Name</span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Law Assistant"
              className="input-base"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Team</span>
            <select
              value={newTeam}
              onChange={(e) => setNewTeam(e.target.value as TeamCode)}
              className="input-base"
            >
              {TEAM_ORDER.map((c) => (
                <option key={c} value={c}>
                  {TEAM_LABEL[c]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Default Attendance</span>
            <select
              value={newDefault}
              onChange={(e) => setNewDefault(e.target.value as AttendanceStatus)}
              className="input-base"
            >
              {DEFAULT_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <button
              onClick={handleAddAssistant}
              disabled={!newName.trim() || pending}
              className="btn btn-primary w-full"
            >
              Add Assistant
            </button>
          </div>
        </div>
      </section>

      <div className="sticky bottom-3 mt-6 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-slate-600">
            {dirtyAttendanceCount > 0
              ? `${dirtyAttendanceCount} attendance change(s) pending`
              : "No attendance changes"}
          </span>
          <button
            onClick={handleSubmitAttendance}
            disabled={
              pending ||
              dirtyAttendanceCount === 0 ||
              initialAssistants.some(
                (a) => draft[a.id] === "OTHER" && (unavailableDraft[a.id]?.length ?? 0) === 0
              )
            }
            className="btn btn-primary"
          >
            {pending ? "Submitting..." : `Submit Attendance (${dirtyAttendanceCount})`}
          </button>
        </div>
      </div>
    </main>
  );
}
