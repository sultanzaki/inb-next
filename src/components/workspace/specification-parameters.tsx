import type { SpesifikasiItem } from "@/lib/types";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
export function specificationLabel(s: SpesifikasiItem) {
  return s.tipe_batas === "TEXT"
    ? s.keterangan || "Observation"
    : s.tipe_batas === "MIN"
      ? `≥ ${s.nilai_min}`
      : s.tipe_batas === "MAX"
        ? `≤ ${s.nilai_maks}`
        : `${s.nilai_min} – ${s.nilai_maks}`;
}
export function SpecificationParameters({
  items,
}: {
  items: SpesifikasiItem[];
}) {
  return (
    <div className="specification-parameters">
      <div className="parameter-desktop-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Parameter</TableHead>
              <TableHead>Standard</TableHead>
              <TableHead>Unit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((s) => (
              <TableRow key={s.id}>
                <TableCell>{s.parameter_uji}</TableCell>
                <TableCell>{specificationLabel(s)}</TableCell>
                <TableCell>{s.satuan || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <dl className="parameter-mobile-list" aria-label="Test parameters">
        {items.map((s, index) => (
          <div className="parameter-mobile-card" key={s.id}>
            <dt>
              <span className="parameter-step" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>{s.parameter_uji}</span>
            </dt>
            <dd>
              <span className="parameter-card-caption">Standard</span>
              <p>{specificationLabel(s)}</p>
              {s.satuan && (
                <span className="parameter-card-unit">{s.satuan}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
