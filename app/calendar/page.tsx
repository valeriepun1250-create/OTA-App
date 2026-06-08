import { getCalendarMonth, getCurrentUser, getMonthlyRoster } from "@/app/actions/queries";
import { CalendarRosterClient } from "@/components/calendar/CalendarRosterClient";
import { getTodayInHongKong } from "@/lib/date";

export const dynamic = "force-dynamic";

function currentMonth() {
  return getTodayInHongKong().slice(0, 7);
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  const user = await getCurrentUser();
  const monthStr = searchParams.month ?? currentMonth();
  const [calendar, roster] = await Promise.all([
    getCalendarMonth(monthStr),
    getMonthlyRoster(monthStr),
  ]);

  return (
    <CalendarRosterClient
      monthStr={monthStr}
      canEdit={user.canManageAttendance}
      calendar={calendar}
      roster={roster}
    />
  );
}
