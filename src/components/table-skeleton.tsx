import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";

export function TableSkeleton({ rows, cols }: { rows: number; cols: number }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="px-4 py-4">
        <div className="space-y-2">
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </TableCell>
    </TableRow>
  );
}
