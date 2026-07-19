import Navbar from "@/components/Navbar";

function Pulse({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-zinc-200/80 ${className ?? ""}`} />;
}

export default function PropertyDetailLoading() {
  return (
    <div className="min-h-screen bg-zinc-50 pb-24 md:pb-8">
      <Navbar />

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
        <div className="space-y-3">
          <Pulse className="h-4 w-28" />

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-3">
              <Pulse className="h-9 w-3/4 max-w-md sm:h-10" />
              <div className="flex flex-wrap items-center gap-4">
                <Pulse className="h-4 w-36" />
                <Pulse className="h-4 w-20" />
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
              <Pulse className="h-9 w-40 sm:h-10" />
              <Pulse className="mt-2 h-4 w-32" />
            </div>
          </div>
        </div>

        {/* Bento gallery skeleton */}
        <div className="grid grid-cols-1 gap-2 overflow-hidden rounded-2xl sm:grid-cols-4 sm:grid-rows-2 sm:gap-2">
          <Pulse className="aspect-[4/3] w-full sm:col-span-2 sm:row-span-2 sm:aspect-auto sm:min-h-[320px]" />
          <Pulse className="hidden aspect-[4/3] sm:block" />
          <Pulse className="hidden aspect-[4/3] sm:block" />
          <Pulse className="hidden aspect-[4/3] sm:block" />
          <Pulse className="hidden aspect-[4/3] sm:block" />
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="space-y-6">
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <Pulse className="h-5 w-40" />
              <div className="mt-6 flex justify-center">
                <Pulse className="h-48 w-48 rounded-full" />
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Pulse className="h-16 rounded-xl" />
                <Pulse className="h-16 rounded-xl" />
                <Pulse className="h-16 rounded-xl" />
                <Pulse className="h-16 rounded-xl" />
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <Pulse className="h-5 w-28" />
              <div className="mt-4 flex flex-wrap gap-2">
                <Pulse className="h-7 w-16 rounded-full" />
                <Pulse className="h-7 w-20 rounded-full" />
                <Pulse className="h-7 w-14 rounded-full" />
                <Pulse className="h-7 w-24 rounded-full" />
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <Pulse className="h-5 w-24" />
              <div className="mt-4 space-y-2.5">
                <Pulse className="h-4 w-full" />
                <Pulse className="h-4 w-full" />
                <Pulse className="h-4 w-5/6" />
                <Pulse className="h-4 w-4/5" />
                <Pulse className="h-4 w-3/4" />
              </div>
            </div>
          </section>

          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <Pulse className="h-4 w-24" />
              <Pulse className="h-8 w-36" />
              <Pulse className="h-4 w-28" />
              <div className="rounded-xl border border-zinc-100 p-3">
                <div className="flex items-center gap-3">
                  <Pulse className="h-12 w-12 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Pulse className="h-4 w-24" />
                    <Pulse className="h-3 w-20" />
                  </div>
                </div>
              </div>
              <Pulse className="h-11 w-full rounded-lg" />
              <Pulse className="h-11 w-full rounded-lg" />
              <Pulse className="h-11 w-full rounded-lg" />
              <Pulse className="h-10 w-full rounded-lg" />
              <div className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2">
                <Pulse className="h-4 w-24" />
                <Pulse className="h-8 w-8 rounded-full" />
              </div>
            </div>
          </aside>
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 p-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-7xl flex-col gap-2">
          <div className="flex items-center gap-2">
            <Pulse className="h-11 flex-1 rounded-lg" />
            <Pulse className="h-11 w-16 rounded-lg" />
            <Pulse className="h-11 w-11 rounded-lg" />
          </div>
          <Pulse className="h-11 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
