"use client";

import { useRef, useState, useTransition } from "react";
import { updateAssignmentNote } from "@/app/actions/mutations";

interface Props {
  assignmentId: string;
  initial: string | null;
}

export function TaskNoteField({ assignmentId, initial }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [value, setValue] = useState(initial ?? "");
  const [savedValue, setSavedValue] = useState(initial ?? "");
  const [pending, startTransition] = useTransition();
  const [justSaved, setJustSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleExpand = () => {
    setExpanded(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const current = e.target.value;
    if (current !== savedValue) {
      startTransition(async () => {
        await updateAssignmentNote({ assignmentId, note: current });
        setSavedValue(current);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 1500);
      });
    }
    setExpanded(false);
  };

  if (!expanded) {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={handleExpand}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <span>Note:</span>
          <span className={value ? "text-slate-600" : ""}>{value || "Tap to add"}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 flex items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        placeholder="Enter note (auto-saves on blur)"
        className="input-base mt-0 min-h-[40px] w-full text-base"
      />
      {pending && <span className="shrink-0 text-sm text-slate-400">Saving...</span>}
      {justSaved && !pending && <span className="shrink-0 text-sm text-emerald-600">Saved</span>}
    </div>
  );
}
