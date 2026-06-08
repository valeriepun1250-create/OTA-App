import Link from "next/link";

export const dynamic = "force-dynamic";

const ENTRY_POINTS = [
  {
    href: "/assign",
    icon: "📝",
    title: "Therapist Assignment",
    subtitle: "治療師任務分派",
    accentClass: "from-teal-100/80 via-cyan-50/70 to-white",
  },
  {
    href: "/assistant",
    icon: "📋",
    title: "Assistant Dashboard",
    subtitle: "助理工作清單",
    accentClass: "from-emerald-100/80 via-lime-50/70 to-white",
  },
  {
    href: "/attendance",
    icon: "👥",
    title: "Attendance Management",
    subtitle: "出勤與人力設定",
    accentClass: "from-amber-100/80 via-orange-50/70 to-white",
  },
  {
    href: "/calendar",
    icon: "🗓️",
    title: "Calendar and Roster",
    subtitle: "假期月曆與整月排程",
    accentClass: "from-cyan-100/80 via-sky-50/70 to-white",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-4 py-10 sm:px-8 md:min-h-[100svh] md:py-14 lg:px-10">
      <div className="w-full">
        <header className="mb-8 text-center md:mb-10">
          <p className="mx-auto mb-3 h-1 w-16 rounded-full bg-teal-700/70" />
          <h1 className="text-4xl font-bold leading-tight text-slate-900 sm:text-5xl md:text-6xl">
            OTA Operations Center
          </h1>
        </header>

        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2 lg:max-w-none lg:grid-cols-4">
          {ENTRY_POINTS.map((entry) => (
            <Link
              key={entry.href}
              href={entry.href}
              className={`group relative min-h-[172px] overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br ${entry.accentClass} p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md sm:min-h-[190px] lg:min-h-[210px]`}
            >
              <div className="flex h-full flex-col justify-between">
                <div>
                  <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-white/80 text-3xl shadow-sm">
                    {entry.icon}
                  </div>
                  <div className="text-lg font-semibold leading-snug text-slate-800">
                    {entry.title}
                  </div>
                  <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                    {entry.subtitle}
                  </div>
                </div>
                <div className="mt-5 inline-flex items-center text-sm font-semibold text-teal-800 transition group-hover:text-teal-900">
                  Enter
                  <span className="ml-1 transition-transform group-hover:translate-x-0.5">→</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
