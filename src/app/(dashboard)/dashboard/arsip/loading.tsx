import { Skeleton } from "@/components/ui/skeleton";

// Static skeletons (no pulse) mirroring the arsip list anatomy:
// header → toolbar (search + meta) → table card with micro-label header row.
export default function ArsipLoading() {
  return (
    <div className="space-y-6">
      {/* Page header: micro-label + title + subtitle left, action button right */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="mt-2 h-7 w-44" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-36" />
      </div>

      {/* Toolbar: search 240px left, result meta right */}
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-9 w-60" />
        <Skeleton className="h-4 w-28" />
      </div>

      {/* Table card: hairline border, radius 8, header row on surface-alt */}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex h-11 items-center gap-6 border-b border-border bg-surface-alt px-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-8" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex h-11 items-center gap-6 border-b border-border-soft px-3 last:border-0"
          >
            <div className="space-y-1">
              <Skeleton className="h-3.5 w-44" />
              <Skeleton className="h-3 w-14" />
            </div>
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-3.5 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
