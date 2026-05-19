import { Suspense } from "react";
import DashboardPageClient from "./DashboardPageClient";

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-zinc-500">
          載入中…
        </div>
      }
    >
      <DashboardPageClient />
    </Suspense>
  );
}
