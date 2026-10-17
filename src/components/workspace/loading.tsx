import { Skeleton } from "@/components/ui/skeleton";
export function ModuleLoading({
  title = "Loading workspace",
}: {
  title?: string;
}) {
  return (
    <div role="status" aria-label={title} className="page-stack">
      <div className="flex items-center justify-between">
        <div className="min-w-0 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
        <Skeleton className="hidden h-10 w-32 sm:block" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Skeleton className="h-10 w-64 max-w-full" />
        <Skeleton className="h-10 w-36" />
      </div>
      <div className="data-card">
        <div className="flex h-12 items-center gap-5 overflow-hidden border-b border-border-soft bg-surface-alt px-5">
          <Skeleton className="h-2.5 w-28" />
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="h-2.5 w-16" />
        </div>
        {Array.from({ length: 7 }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-border-soft px-5 py-4 last:border-0"
          >
            <Skeleton className="size-9 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-40 max-w-full" />
              <Skeleton className="h-2 w-20" />
            </div>
            <Skeleton className="hidden h-3 w-24 sm:block" />
            <Skeleton className="h-6 w-14 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
