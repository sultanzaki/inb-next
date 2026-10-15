import { Skeleton } from "@/components/ui/skeleton";

export default function ProdukLoading() {
  return (
    <div className="space-y-5">
      <div>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-56 mt-1" />
      </div>
      <Skeleton className="h-9 w-64 rounded-lg" />
      <div className="rounded-xl border border-border bg-white">
        <div className="p-5 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
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
