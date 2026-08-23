import { Suspense } from "react";
import { AssistantDashboardClient } from "@/components/AssistantDashboardClient";

export function generateStaticParams() {
  return ["a001", "a002", "a003", "a004", "a005", "a006", "a007"].map((id) => ({ id }));
}

export default function AssistantDashboardPage({ params }: { params: { id: string } }) {
  return <Suspense fallback={<main className="app-shell"><section className="panel text-sm text-slate-500">Connecting to Firebase...</section></main>}><AssistantDashboardClient assistantId={params.id} /></Suspense>;
}
