"use client";

import { useEffect, useState } from "react";
import { AttendanceForm } from "@/components/AttendanceForm";
import { getTodayInHongKong } from "@/lib/date";
import {
  getCachedFirebaseAttendancePage,
  listenToFirebaseAttendancePage,
} from "@/lib/firebase-attendance";

export const dynamic = "force-static";

export default function AttendancePage() {
  const [dateStr, setDateStr] = useState(getTodayInHongKong());
  const [data, setData] = useState(() => getCachedFirebaseAttendancePage(dateStr));
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    setData(getCachedFirebaseAttendancePage(dateStr));
    return listenToFirebaseAttendancePage(
      dateStr,
      setData,
      (reason) => setError(reason.message || "Firebase connection failed")
    );
  }, [dateStr]);

  if (error) return <main className="app-shell"><section className="panel border-rose-200 bg-rose-50 text-rose-700">{error}</section></main>;
  if (!data) return <main className="app-shell"><section className="panel text-sm text-slate-500">Loading attendance...</section></main>;

  return (
    <AttendanceForm
      key={dateStr}
      initialDate={dateStr}
      initialAssistants={data.assistants}
      initialWeights={data.weights}
      onDateChange={setDateStr}
    />
  );
}
