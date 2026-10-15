import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* Greeting skeleton */}
      <div className="space-y-1.5">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-4 w-44" />
      </div>

      {/* 6 stat card skeletons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-white p-5">
            <div className="flex items-start gap-4">
              <Skeleton className="size-11 rounded-xl shrink-0" />
              <div className="flex-1 min-w-0 space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-7 w-16" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Donut + table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="rounded-xl border border-border bg-white p-6">
          <Skeleton className="h-4 w-32 mb-6" />
          <div className="flex flex-col items-center gap-4">
            <Skeleton className="size-36 rounded-full" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <div className="lg:col-span-2 rounded-xl border border-border bg-white">
          <div className="px-5 py-4 border-b border-border">
            <Skeleton className="h-4 w-36" />
          </div>
          <div className="p-5 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
