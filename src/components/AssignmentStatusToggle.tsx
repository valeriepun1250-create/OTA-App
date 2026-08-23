"use client";

import { useState, useTransition } from "react";
import { updateAssignment } from "@/lib/firebase-data";
import { AssignmentStatus } from "@/types/db-enums";

const NEXT_STATUS: Partial<Record<AssignmentStatus, AssignmentStatus>> = {
  PENDING: "IN_PROGRESS",
  IN_PROGRESS: "DONE",
};

const STATUS_LABEL: Record<AssignmentStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

const STATUS_STYLE: Record<AssignmentStatus, string> = {
  PENDING: "bg-slate-100 text-slate-700",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  DONE: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-rose-100 text-rose-700",
};

interface Props {
  assignmentId: string;
  date: string;
  current: AssignmentStatus;
}

export function AssignmentStatusToggle({ assignmentId, date, current }: Props) {
  const [status, setStatus] = useState<AssignmentStatus>(current);
  const [pending, startTransition] = useTransition();
  const next = NEXT_STATUS[status];

  const handleAdvance = () => {
    if (!next) return;
    startTransition(async () => {
      await updateAssignment(date, assignmentId, { status: next });
      setStatus(next);
    });
  };

  return (
    <div className="flex items-center gap-2">
      <span className={`badge ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
      {next && (
        <button onClick={handleAdvance} disabled={pending} className="btn btn-primary min-h-[38px] px-3 py-1.5 text-xs">
          {pending ? "Updating..." : `→ ${STATUS_LABEL[next]}`}
        </button>
      )}
    </div>
  );
}
