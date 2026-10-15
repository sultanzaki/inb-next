import { Skeleton } from "@/components/ui/skeleton";

export default function ProdukLoading() {
  return (
    <div className="space-y-6">
      {/* Header: title + subtitle left, action button right */}
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-56 mt-1" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Skeleton className="h-8 w-full rounded-lg" />
      </div>

      {/* Table card: same wrapper classes as the page */}
      <div className="rounded-xl bg-surface shadow-card-sm overflow-hidden">
        <div className="bg-muted/50 h-9" />
        <div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-9 flex items-center gap-4 px-4 border-b border-border last:border-0"
            >
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
