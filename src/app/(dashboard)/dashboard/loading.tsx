import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-4 w-44 mt-1" />
      </div>

      {/* KPI stat cards: count matches statCards.length */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl bg-surface shadow-card-sm p-5 flex items-start gap-4"
          >
            <Skeleton className="size-11 rounded-xl shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-16" />
            </div>
          </div>
        ))}
      </div>

      {/* Donut chart + Recent inspections table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pass/Fail ring chart */}
        <div className="rounded-xl bg-surface shadow-card-sm p-5 lg:p-6 flex flex-col items-center justify-center">
          <Skeleton className="h-4 w-32 self-start mb-5" />
          <div className="flex flex-col items-center gap-4">
            <Skeleton className="size-36 rounded-full" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>

        {/* Inspeksi Terbaru table */}
        <div className="lg:col-span-2 rounded-xl bg-surface shadow-card-sm">
          <div className="px-5 py-4 border-b border-border">
            <Skeleton className="h-4 w-36" />
          </div>
          <div className="p-5 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-14 rounded-full ml-auto" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
