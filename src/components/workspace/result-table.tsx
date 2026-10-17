import type { HasilUjiItem } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";

export function ResultTable({ items }: { items: HasilUjiItem[] }) {
  return (
    <div className="data-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Parameter</TableHead>
            <TableHead>Standard</TableHead>
            <TableHead>Results</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, index) => (
            <TableRow key={item.spec_id || index}>
              <TableCell className="font-medium">{item.p}</TableCell>
              <TableCell className="font-data text-xs text-muted">
                {item.t === "TEXT"
                  ? item.k || "Observation"
                  : item.t === "MIN"
                    ? `≥ ${item.mn}`
                    : item.t === "MAX"
                      ? `≤ ${item.mx}`
                      : `${item.mn} – ${item.mx}`}
              </TableCell>
              <TableCell className="font-data">
                {item.val || "—"}
                {item.u && (
                  <span className="ml-1 text-xs text-muted">{item.u}</span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={item.st === "PASS" ? "default" : "destructive"}>
                  {item.st}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
