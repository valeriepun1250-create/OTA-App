"use client";

import { useEffect, useState } from "react";
import { CalendarRosterClient } from "@/components/calendar/CalendarRosterClient";
import { getTodayInHongKong } from "@/lib/date";
import {
  getCachedFirebaseCalendarMonth,
  listenToFirebaseCalendarMonth,
} from "@/lib/firebase-calendar";

export const dynamic = "force-static";

export default function CalendarPage() {
  const [monthStr, setMonthStr] = useState(getTodayInHongKong().slice(0, 7));
  const [data, setData] = useState(() => getCachedFirebaseCalendarMonth(monthStr));
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    setData(getCachedFirebaseCalendarMonth(monthStr));
    return listenToFirebaseCalendarMonth(
      monthStr,
      setData,
      (reason) => setError(reason.message || "Firebase connection failed")
    );
  }, [monthStr]);

  if (error) return <main className="app-shell"><section className="panel border-rose-200 bg-rose-50 text-rose-700">{error}</section></main>;
  if (!data) return <main className="app-shell"><section className="panel text-sm text-slate-500">Loading calendar...</section></main>;
  return <CalendarRosterClient key={monthStr} monthStr={monthStr} canEdit calendar={data} roster={data.roster} onMonthChange={setMonthStr} />;
}
