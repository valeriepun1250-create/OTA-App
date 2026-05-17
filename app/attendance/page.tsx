import {
  getCurrentUser,
  getDailyAttendance,
  getTeamWeights,
} from "@/app/actions/queries";
import { AttendanceForm } from "@/components/AttendanceForm";
import { getTodayInHongKong } from "@/lib/date";

export const dynamic = "force-dynamic"; // Ensure attendance data is re-fetched each time

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const user = await getCurrentUser();

  // Permission check — only canManageAttendance can enter
  if (!user.canManageAttendance) {
    return (
      <main className="app-shell max-w-2xl">
        <section className="panel border-rose-200 bg-rose-50/70">
          <h1 className="text-xl font-bold text-rose-700">Insufficient Permissions</h1>
          <p className="mt-2 text-sm text-slate-600">
          Current user: <span className="font-mono">{user.name}</span> ({user.role})
          does not have <code className="rounded bg-slate-100 px-1">canManageAttendance</code> permission.
          Please contact the administrator.
          </p>
        </section>
      </main>
    );
  }

  const dateStr = searchParams.date ?? getTodayInHongKong();
  const [assistants, weights] = await Promise.all([
    getDailyAttendance(dateStr),
    getTeamWeights(),
  ]);

  return (
    <AttendanceForm
      initialDate={dateStr}
      initialAssistants={assistants}
      initialWeights={weights}
    />
  );
}
