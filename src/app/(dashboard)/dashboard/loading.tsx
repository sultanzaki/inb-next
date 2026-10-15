import { Skeleton } from "@/components/ui/skeleton";

// Static, hairline skeleton mirroring the dashboard layout: header row,
// KPI instrument strip (one hairline-divided card), 2fr zone (table card
// + right stack of ring/documents cards). No pulse — instrument aesthetic.
export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-40" />
        </div>
        <Skeleton className="h-11 w-44" />
      </div>

      {/* KPI instrument strip */}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4 xl:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="bg-surface p-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-7 w-12" />
            </div>
          ))}
        </div>
      </div>

      {/* Two-column zone */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[2fr_1fr]">
        {/* Inspeksi Terbaru table card */}
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-4 py-3">
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="flex h-11 items-center gap-4 bg-surface-alt px-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="ml-auto h-3 w-14" />
          </div>
          <div className="divide-y divide-border-soft">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex h-11 items-center gap-4 px-3">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="ml-auto h-3.5 w-20" />
                <Skeleton className="h-5 w-14" />
              </div>
            ))}
          </div>
        </div>

        {/* Right stack: ring card + documents card */}
        <div className="flex flex-col gap-6">
          <div className="rounded-lg border border-border bg-surface p-4">
            <Skeleton className="h-3 w-28" />
            <div className="mt-4 flex justify-center">
              <Skeleton className="size-40 rounded-full" />
            </div>
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-14" />
                <Skeleton className="h-3.5 w-8" />
              </div>
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-14" />
                <Skeleton className="h-3.5 w-8" />
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-surface p-4">
            <Skeleton className="h-3 w-20" />
            <div className="mt-4 grid grid-cols-2">
              <div className="pr-4">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="mt-2 h-7 w-12" />
              </div>
              <div className="border-l border-border-soft pl-4">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="mt-2 h-7 w-12" />
              </div>
            </div>
            <Skeleton className="mt-4 h-3.5 w-28" />
          </div>
        </div>
      </div>
    </div>
  );
}
