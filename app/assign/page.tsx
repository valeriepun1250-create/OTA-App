"use client";

import { Suspense, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  getDailyQuotas,
  getDailyTeamUsage,
  getDailyTaskRequests,
  getDistributionBoard,
} from "@/app/actions/queries";
import {
  cleanupExpiredS1Tasks,
  createTaskRequest,
  deleteS1Task,
  dispatchPendingTasks,
  generateAutoSchedule,
  updateS1TaskContent,
} from "@/app/actions/mutations";
import { S1_SPECIALTY_OPTIONS, TEAM_LABEL, TEAM_ORDER, type TeamCode } from "@/types/db-enums";
import type { TeamPoolQuota } from "@/lib/allocation";
import { getTodayInHongKong } from "@/lib/date";

type Mode = "S1" | "PCA";
const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "S1", label: "S1 Task Distribution" },
  { value: "PCA", label: "S2-S5 PCA Distribution" },
];

const PCA_SLOT_TIME: Record<"S2" | "S3" | "S4" | "S5", string> = {
  S2: "10:00-11:15",
  S3: "11:15-12:30",
  S4: "13:30-15:15",
  S5: "15:15-17:00",
};
const PCA_SLOTS = ["S2", "S3", "S4", "S5"] as const;
const TASK_STATUS_META: Record<string, { label: string; className: string }> = {
  PENDING: {
    label: "Pending",
    className: "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200",
  },
  IN_PROGRESS: {
    label: "In Progress",
    className: "bg-yellow-100 text-yellow-800 ring-1 ring-inset ring-yellow-200",
  },
  DONE: {
    label: "Done",
    className: "bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-200",
  },
};

function TaskStatusBadge({ status }: { status: string }) {
  const meta =
    TASK_STATUS_META[status] ?? {
      label: status.replace(/_/g, " "),
      className: "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200",
    };

  return <span className={`badge ${meta.className}`}>{meta.label}</span>;
}

function PencilIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

interface TaskRow {
  id: string;
  ward: string;
  initial: string | null;
  hnPrefix: string | null;
  therapistName: string | null;
  specialty: string | null;
  content: string | null;
  score: number;
  status: string;
  assistantId: string | null;
  assistantName: string | null;
  assistantTeam: string | null;
  isPending: boolean;
}

export default function AssignPage() {
  return (
    <Suspense fallback={<AssignPageSkeleton />}>
      <AssignPageContent />
    </Suspense>
  );
}

function AssignPageContent() {
  const searchParams = useSearchParams();
  const today = getTodayInHongKong();
  const [dateStr, setDateStr] = useState(searchParams.get("date") ?? today);
  const [mode, setMode] = useState<Mode>("S1");

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [quotas, setQuotas] = useState<{
    am: TeamPoolQuota[];
    pm: TeamPoolQuota[];
    amOnDuty: number;
    pmOnDuty: number;
  } | null>(null);
  const [usage, setUsage] = useState<Record<string, { am: number; pm: number }>>({});
  const [board, setBoard] = useState<
    Record<string, Record<string, { id: string; name: string; homeTeam: TeamCode | null }[]>> | null
  >(null);

  const [pending, startTransition] = useTransition();
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [isTaskSearchOpen, setIsTaskSearchOpen] = useState(false);
  const [taskSearch, setTaskSearch] = useState("");
  const [taskError, setTaskError] = useState("");
  const taskSearchInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    ward: "",
    initial: "",
    hnPrefix: "",
    therapistName: "",
    specialty: "Medical",
    content: "",
  });

  const isS1 = mode === "S1";
  const pendingCount = tasks.filter((t) => t.isPending).length;
  const taskSearchTerm = taskSearch.trim().toLowerCase();
  const filteredTasks = useMemo(() => {
    if (!taskSearchTerm) return tasks;

    return tasks.filter((task) =>
      [
        task.ward,
        task.initial,
        task.hnPrefix,
        task.therapistName,
        task.specialty ?? "Medical",
        task.content,
        String(task.score),
        task.assistantName,
        task.assistantTeam,
        task.status,
        task.isPending ? "pending" : "assigned",
      ].some((value) => value?.toLowerCase().includes(taskSearchTerm))
    );
  }, [tasks, taskSearchTerm]);
  const isTaskFormComplete =
    !!form.ward.trim() &&
    !!form.initial.trim() &&
    !!form.hnPrefix.trim() &&
    !!form.therapistName.trim() &&
    !!form.specialty.trim() &&
    !!form.content.trim();

  const refreshS1 = () => {
    startTransition(async () => {
      await cleanupExpiredS1Tasks();
      const list = await getDailyTaskRequests(dateStr);
      setTasks(list);
    });
  };

  const refreshS2S5 = () => {
    startTransition(async () => {
      const [q, u, b] = await Promise.all([
        getDailyQuotas(dateStr),
        getDailyTeamUsage(dateStr),
        getDistributionBoard(dateStr),
      ]);
      setQuotas(q);
      setUsage(u);
      setBoard(b.board);
    });
  };

  useEffect(() => {
    if (isS1) {
      refreshS1();
      return;
    }
    refreshS2S5();
  }, [dateStr, mode]);

  useEffect(() => {
    if (isTaskSearchOpen) {
      taskSearchInputRef.current?.focus();
    }
  }, [isTaskSearchOpen]);

  const handleAddTask = () => {
    if (!isTaskFormComplete) return;
    startTransition(async () => {
      try {
        setTaskError("");
        await createTaskRequest({
          dateStr,
          ward: form.ward.trim(),
          initial: form.initial.trim() || undefined,
          hnPrefix: form.hnPrefix.trim() || undefined,
          therapistName: form.therapistName.trim() || undefined,
          specialty: form.specialty.trim() || undefined,
          content: form.content.trim(),
        });
        setForm((f) => ({ ...f, ward: "", initial: "", hnPrefix: "", content: "" }));
        refreshS1();
      } catch (error) {
        setTaskError(error instanceof Error ? error.message : "Task submission failed");
      }
    });
  };

  const handleBatchDispatch = () => {
    startTransition(async () => {
      await dispatchPendingTasks(dateStr);
      refreshS1();
    });
  };

  const handleDeleteTask = (task: TaskRow) => {
    if (!confirm(`Delete S1 task for ${task.ward}?`)) return;
    startTransition(async () => {
      try {
        setTaskError("");
        await deleteS1Task(task.id);
        if (editingTaskId === task.id) {
          setEditingTaskId(null);
          setEditingContent("");
        }
        refreshS1();
      } catch (error) {
        setTaskError(error instanceof Error ? error.message : "Task deletion failed");
      }
    });
  };

  const startEditingTask = (task: TaskRow) => {
    setEditingTaskId(task.id);
    setEditingContent(task.content ?? "");
  };

  const handleSaveContent = () => {
    if (!editingTaskId || !editingContent.trim()) return;
    startTransition(async () => {
      try {
        setTaskError("");
        await updateS1TaskContent({
          assignmentId: editingTaskId,
          content: editingContent.trim(),
        });
        setEditingTaskId(null);
        setEditingContent("");
        refreshS1();
      } catch (error) {
        setTaskError(error instanceof Error ? error.message : "Task update failed");
      }
    });
  };

  return (
    <main className="app-shell">
      <header className="page-hero">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="badge bg-teal-100 text-teal-800">Therapist Workflow</p>
            <h1 className="mt-3 text-2xl font-bold sm:text-3xl">Therapist Assignment</h1>
          </div>
          <Link href="/" className="btn btn-secondary">
            ← Home
          </Link>
        </div>
      </header>

      <section className="panel">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold">Date</span>
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="input-base"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold">Mode</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              className="input-base"
            >
              {MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section
        className={`mt-4 rounded-2xl border p-4 text-sm ${
          isS1
            ? "border-amber-200 bg-amber-50/90 text-amber-900"
            : "border-teal-200 bg-teal-50/90 text-teal-900"
        }`}
      >
        {isS1 ? (
          <>
            <strong>S1 Task Mode</strong>: Tasks will be automatically distributed at 8:45am; you
            can click "Late Assign" to manually assign after 8:45am.
          </>
        ) : (
          <strong>PCA Auto Distribution</strong>
        )}
      </section>

      {isS1 && (
        <>
          <section className="panel mt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">New Task</h2>
              <span className="badge bg-slate-100 text-slate-700">
                Preview Score: {/moca/i.test(form.content) ? 2 : 1}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[repeat(16,minmax(0,1fr))]">
              <Field
                label="Ward / Bed no. *"
                value={form.ward}
                onChange={(v) => setForm((f) => ({ ...f, ward: v }))}
                placeholder="e.g. E8/19"
                className="md:col-span-2"
              />
              <Field
                label="Initial *"
                value={form.initial}
                onChange={(v) => setForm((f) => ({ ...f, initial: v }))}
                placeholder="e.g. Chan TM"
                className="md:col-span-2"
              />
              <Field
                label="NH no. *"
                value={form.hnPrefix}
                onChange={(v) => setForm((f) => ({ ...f, hnPrefix: v }))}
                placeholder="e.g. 296X"
                className="md:col-span-2"
              />
              <Field
                label="Therapist *"
                value={form.therapistName}
                onChange={(v) => setForm((f) => ({ ...f, therapistName: v }))}
                placeholder="e.g. Jamie"
                className="md:col-span-2"
              />
              <SpecialtyField
                value={form.specialty}
                onChange={(v) => setForm((f) => ({ ...f, specialty: v }))}
                className="md:col-span-2"
              />
              <Field
                label="Content *"
                value={form.content}
                onChange={(v) => setForm((f) => ({ ...f, content: v }))}
                placeholder="e.g. MoCA cognitive assessment"
                className="md:col-span-6"
              />
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {taskError && (
                <div className="mr-auto rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
                  {taskError}
                </div>
              )}
              <button
                onClick={handleBatchDispatch}
                disabled={pending || pendingCount === 0}
                className="btn btn-secondary"
                title="Late-assign all pending tasks to nearby assistants at once"
              >
                Late Assign ({pendingCount})
              </button>
              <button
                onClick={handleAddTask}
                disabled={pending || !isTaskFormComplete}
                className="btn btn-accent"
              >
                Submit Task
              </button>
            </div>
          </section>

          <section className="mt-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <h2 className="text-lg font-semibold">Today's S1 Tasks</h2>
                <button
                  type="button"
                  onClick={() => {
                    if (isTaskSearchOpen) {
                      setTaskSearch("");
                      setIsTaskSearchOpen(false);
                      return;
                    }
                    setIsTaskSearchOpen(true);
                  }}
                  className="btn btn-secondary h-9 w-9 min-h-0 p-0"
                  aria-label={isTaskSearchOpen ? "Close S1 task search" : "Search S1 tasks"}
                  title={isTaskSearchOpen ? "Close search" : "Search"}
                >
                  <SearchIcon />
                </button>
                {isTaskSearchOpen && (
                  <div className="w-full sm:w-64">
                    <label htmlFor="s1-task-search" className="sr-only">
                      Search S1 tasks
                    </label>
                    <input
                      id="s1-task-search"
                      ref={taskSearchInputRef}
                      type="text"
                      value={taskSearch}
                      onChange={(e) => setTaskSearch(e.target.value)}
                      placeholder="Search tasks"
                      className="input-base mt-0 h-9"
                    />
                  </div>
                )}
              </div>
              <span className="text-sm text-slate-600">
                {taskSearchTerm ? `Showing ${filteredTasks.length} of ${tasks.length}` : `Total ${tasks.length}`} · Pending{" "}
                {pendingCount}
              </span>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ward</th>
                    <th>Initial</th>
                    <th>HN</th>
                    <th>Therapist</th>
                    <th>Specialty</th>
                    <th>Content</th>
                    <th>Pts</th>
                    <th>Assistant</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.map((t) => {
                    const isEditing = editingTaskId === t.id;
                    return (
                      <tr key={t.id} className={t.isPending ? "bg-amber-50/50" : ""}>
                        <td className="font-mono font-semibold">{t.ward}</td>
                        <td>{t.initial ?? "—"}</td>
                        <td className="font-mono">{t.hnPrefix ?? "—"}</td>
                        <td>{t.therapistName ?? "—"}</td>
                        <td>{t.specialty ?? "Medical"}</td>
                        <td className="min-w-60">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editingContent}
                              onChange={(e) => setEditingContent(e.target.value)}
                              className="input-base min-w-56"
                            />
                          ) : (
                            t.content ?? "—"
                          )}
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              t.score >= 2 ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {t.score}
                          </span>
                        </td>
                        <td>
                          {t.isPending ? (
                            <span className="badge bg-amber-100 text-amber-800">Pending</span>
                          ) : (
                            <span>
                              {t.assistantName}
                              <span className="ml-1 text-xs text-slate-500">({t.assistantTeam})</span>
                            </span>
                          )}
                        </td>
                        <td>
                          <TaskStatusBadge status={t.status} />
                        </td>
                        <td className="whitespace-nowrap">
                          {isEditing ? (
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                onClick={handleSaveContent}
                                disabled={pending || !editingContent.trim()}
                                className="btn btn-primary px-2 py-1 text-xs"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingTaskId(null);
                                  setEditingContent("");
                                }}
                                disabled={pending}
                                className="btn btn-secondary px-2 py-1 text-xs"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => startEditingTask(t)}
                                disabled={pending}
                                className="btn btn-secondary h-9 w-9 min-h-0 p-0"
                                aria-label={`Edit S1 task for ${t.ward}`}
                                title="Edit"
                              >
                                <PencilIcon />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteTask(t)}
                                disabled={pending}
                                className="btn h-9 w-9 min-h-0 bg-rose-600 p-0 text-white hover:bg-rose-700"
                                aria-label={`Delete S1 task for ${t.ward}`}
                                title="Delete"
                              >
                                <TrashIcon />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {filteredTasks.length === 0 && !pending && (
                    <tr>
                      <td colSpan={10} className="py-10 text-center text-sm text-slate-400">
                        {tasks.length === 0 ? "No S1 tasks today" : "No matching S1 tasks"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {!isS1 && quotas && (
        <>
          <section className="panel mt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">S2-S5 Distribution Board</h2>
              </div>
              <button
                onClick={() => {
                  if (
                    !confirm(
                      `Regenerate S2-S5 schedule for ${dateStr}?\n(Will overwrite existing S2-S5 assignments, S1 tasks not affected)`
                    )
                  ) {
                    return;
                  }
                  startTransition(async () => {
                    await generateAutoSchedule(dateStr);
                    refreshS2S5();
                  });
                }}
                disabled={pending}
                className="btn btn-primary"
              >
                {pending ? "Computing..." : "Auto-generate Schedule"}
              </button>
            </div>

            {board && (
              <div className="table-wrap mt-4">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Team</th>
                      {PCA_SLOTS.map((s) => (
                        <th key={s}>
                          <div>{s}</div>
                          <div className="font-mono text-[10px] normal-case text-slate-400">
                            {PCA_SLOT_TIME[s]}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {TEAM_ORDER.map((team) => (
                      <tr key={team}>
                        <td className="font-semibold">{TEAM_LABEL[team]}</td>
                        {PCA_SLOTS.map((s) => {
                          const list = board[team]?.[s] ?? [];
                          return (
                            <td key={s}>
                              {list.length === 0 ? (
                                <span className="text-xs text-slate-300">—</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {list.map((p) => (
                                    <span
                                      key={p.id}
                                      className={`badge ${
                                        p.homeTeam === team
                                          ? "bg-emerald-100 text-emerald-800"
                                          : "bg-slate-100 text-slate-700"
                                      }`}
                                      title={
                                        p.homeTeam === team
                                          ? "Home team assistant"
                                          : `Cross-team support (${p.homeTeam ?? "—"})`
                                      }
                                    >
                                      {p.name}
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
                <p className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Green = home team assistant, Gray = cross-team support.
                </p>
              </div>
            )}
          </section>

          <section className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            {(["AM", "PM"] as const).map((pool) => (
              <div key={pool} className="panel">
                <h3 className="text-sm font-semibold">
                  {pool} Pool Quota · On Duty {pool === "AM" ? quotas.amOnDuty : quotas.pmOnDuty}
                </h3>
                <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
                  {(pool === "AM" ? quotas.am : quotas.pm).map((q) => {
                    const used = usage[q.team]?.[pool === "AM" ? "am" : "pm"] ?? 0;
                    const remaining = q.quota - used;
                    const over = remaining < 0;
                    return (
                      <div key={q.team} className="rounded-xl border border-slate-200 bg-white p-2.5 text-xs">
                        <div className="font-semibold">{TEAM_LABEL[q.team]}</div>
                        <div className="text-slate-600">Quota {q.quota}</div>
                        <div className="text-slate-600">Used {used}</div>
                        <div className={over ? "mt-1 font-semibold text-rose-600" : "mt-1 font-semibold text-emerald-700"}>
                          Left {remaining.toFixed(1)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}

function AssignPageSkeleton() {
  return (
    <main className="app-shell">
      <header className="page-hero">
        <div className="h-5 w-36 animate-pulse rounded-full bg-slate-200" />
        <div className="mt-3 h-9 w-64 animate-pulse rounded bg-slate-200" />
      </header>
      <section className="panel">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
        </div>
      </section>
    </main>
  );
}

function SpecialtyField({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <label className={`block min-w-0 ${className ?? ""}`}>
      <span className="text-xs font-semibold text-slate-600">Specialty *</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-base"
      >
        {S1_SPECIALTY_OPTIONS.map((specialty) => (
          <option key={specialty} value={specialty}>
            {specialty}
          </option>
        ))}
      </select>
    </label>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  list,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  list?: string;
  className?: string;
}) {
  return (
    <label className={`block min-w-0 ${className ?? ""}`}>
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        list={list}
        className="input-base"
      />
    </label>
  );
}
