"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AssistantDashboardClient } from "@/components/AssistantDashboardClient";
import { TEAM_LABEL, type TeamCode } from "@/types/db-enums";
import { getTodayInHongKong } from "@/lib/date";
import { getFirebaseAssistantSelector } from "@/lib/firebase-assistant";

type DutyTier = "FULL" | "PARTIAL" | "ABSENT";
const TIER_STYLE: Record<DutyTier, string> = {
  FULL: "border-emerald-300 bg-emerald-50/90 text-emerald-900 hover:border-emerald-500",
  PARTIAL: "border-amber-300 bg-amber-50/90 text-amber-900 hover:border-amber-500",
  ABSENT: "border-slate-200 bg-slate-100 text-slate-500 hover:border-slate-300",
};

export default function AssistantSelectorPage() {
  return <Suspense fallback={<main className="app-shell"><section className="panel text-sm text-slate-500">Connecting to Firebase...</section></main>}><AssistantSelectorContent /></Suspense>;
}

function AssistantSelectorContent() {
  const search = useSearchParams();
  const selectedAssistantId = search.get("assistantId");
  if (selectedAssistantId) return <AssistantDashboardClient assistantId={selectedAssistantId} />;
  return <AssistantSelectorList />;
}

function AssistantSelectorList() {
  const [dateStr, setDateStr] = useState(getTodayInHongKong());
  const [assistants, setAssistants] = useState<Awaited<ReturnType<typeof getFirebaseAssistantSelector>>>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    getFirebaseAssistantSelector(dateStr).then(setAssistants).catch((reason) => setError(reason instanceof Error ? reason.message : "Firebase connection failed"));
  }, [dateStr]);

  return (
    <main className="app-shell">
      <header className="page-hero">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="badge bg-emerald-100 text-emerald-800">Assistant Workflow</p>
            <h1 className="mt-3 text-2xl font-bold sm:text-3xl">Select Assistant</h1>
            <label className="mt-2 block text-sm font-medium text-slate-700">Date
              <input type="date" value={dateStr} onChange={(event) => setDateStr(event.target.value)} className="input-base ml-2 inline-block w-auto" />
            </label>
          </div>
          <Link href="/" className="btn btn-secondary">← Home</Link>
        </div>
      </header>
      {error && <section className="panel border-rose-200 bg-rose-50 text-rose-700">{error}</section>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {assistants.map((assistant) => (
          <li key={assistant.id}>
            <Link
              href={`/assistant?assistantId=${assistant.id}&date=${dateStr}`}
              className={`group flex min-h-[84px] items-center justify-between rounded-2xl border p-4 transition ${TIER_STYLE[assistant.tier as DutyTier]}`}
            >
              <div><div className="text-base font-semibold sm:text-lg">{assistant.name}</div><div className="text-sm opacity-80">{assistant.team ? TEAM_LABEL[assistant.team as TeamCode] : "—"} Team</div></div>
              <span className="badge bg-white/75 text-slate-700 shadow-sm">{assistant.tier === "FULL" ? "Full Day" : assistant.tier === "PARTIAL" ? "Half Day" : "Absent"}</span>
            </Link>
          </li>
        ))}
        {assistants.length === 0 && !error && <li className="panel text-center text-sm text-slate-500 sm:col-span-2">Connecting to Firebase...</li>}
      </ul>
    </main>
  );
}
