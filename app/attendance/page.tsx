"use client";

import { useEffect, useState } from "react";
import { AttendanceForm } from "@/components/AttendanceForm";
import { getTodayInHongKong } from "@/lib/date";
import { getFirebaseDailyAttendance, getFirebaseTeamWeights } from "@/lib/firebase-attendance";

export const dynamic = "force-static";

export default function AttendancePage() {
  const [dateStr, setDateStr] = useState(getTodayInHongKong());
  const [assistants, setAssistants] = useState<Awaited<ReturnType<typeof getFirebaseDailyAttendance>>>([]);
  const [weights, setWeights] = useState<Awaited<ReturnType<typeof getFirebaseTeamWeights>> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getFirebaseDailyAttendance(dateStr), getFirebaseTeamWeights()])
      .then(([nextAssistants, nextWeights]) => {
        setAssistants(nextAssistants);
        setWeights(nextWeights);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Firebase connection failed"));
  }, [dateStr]);

  if (error) return <main className="app-shell"><section className="panel border-rose-200 bg-rose-50 text-rose-700">{error}</section></main>;
  if (!weights) return <main className="app-shell"><section className="panel text-sm text-slate-500">Connecting to Firebase...</section></main>;

  return (
    <AttendanceForm
      key={dateStr}
      initialDate={dateStr}
      initialAssistants={assistants}
      initialWeights={weights}
      onDateChange={setDateStr}
    />
  );
}
