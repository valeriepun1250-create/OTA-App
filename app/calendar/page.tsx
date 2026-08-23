"use client";

import { useEffect, useState } from "react";
import { CalendarRosterClient } from "@/components/calendar/CalendarRosterClient";
import { getTodayInHongKong } from "@/lib/date";
import { getFirebaseCalendarMonth } from "@/lib/firebase-calendar";

export const dynamic = "force-static";

export default function CalendarPage() {
  const [monthStr, setMonthStr] = useState(getTodayInHongKong().slice(0, 7));
  const [data, setData] = useState<Awaited<ReturnType<typeof getFirebaseCalendarMonth>> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getFirebaseCalendarMonth(monthStr)
      .then(setData)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Firebase connection failed"));
  }, [monthStr]);

  if (error) return <main className="app-shell"><section className="panel border-rose-200 bg-rose-50 text-rose-700">{error}</section></main>;
  if (!data) return <main className="app-shell"><section className="panel text-sm text-slate-500">Connecting to Firebase...</section></main>;
  return <CalendarRosterClient monthStr={monthStr} canEdit calendar={data} roster={data.roster} onMonthChange={setMonthStr} />;
}
