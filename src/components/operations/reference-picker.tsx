"use client";
import { useId, useState, useEffect } from "react";
import { ChevronsUpDown, Check, Search } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RecordSkeleton } from "@/components/workspace/record-loading";
import { useWorkRecords } from "./data";
import type { WorkField, WorkRow } from "@/lib/operations/catalog";
import { displayNumber, humanLabel } from "@/lib/erp/ux";
export function ReferencePicker({
  field,
  value,
  onChange,
  values,
  parent,
  disabled,
  id,
  invalid,
}: {
  field: WorkField;
  value: string;
  onChange: (value: string, row?: WorkRow) => void;
  values: Record<string, unknown>;
  parent?: WorkRow;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [chosen, setChosen] = useState<WorkRow | null>(null);
  const generated = useId();
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(q);
      setPage(1);
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);
  const scope = Object.fromEntries(
    Object.entries(field.scope || {}).flatMap(([k, v]) =>
      v.startsWith("$")
        ? values[v.slice(1)]
          ? [[k, String(values[v.slice(1)])]]
          : []
        : [[k, v]],
    ),
  );
  const source =
    field.key === "lot_id" &&
    values.kind === "finished" &&
    (field.ref === "material_lots" || field.ref === "material_inventory")
      ? field.ref === "material_inventory"
        ? "finished_inventory"
        : "finished_lots"
      : field.ref || "units";
  const result = useWorkRecords(
    source,
    { q: search, page, scope },
    open && !field.local,
  );
  const selected = useWorkRecords(
    field.pick === "lot_id"
      ? source.startsWith("finished")
        ? "finished_lots"
        : "material_lots"
      : source,
    { id: value },
    Boolean(value) &&
      !field.local &&
      (!chosen || String(chosen[field.pick || "id"]) !== value),
  );
  const local = ((parent?.[field.local || ""] as WorkRow[]) || [])
    .filter(
      (row) =>
        field.local !== "reservations" ||
        (row.state === "active" && Number(row.remaining) > 0),
    )
    .filter((row) => field.local !== "inputs" || row.kind === "consume");
  const record =
    chosen && String(chosen[field.pick || "id"]) === value
      ? chosen
      : field.local
        ? local.find((row) => row.id === value)
        : selected.data.rows[0];
  function label(row: WorkRow) {
    return String(
      row.label ||
        [
          row.material || row.product || row.number || row.lot || row.name,
          row.lot,
          row.location,
          row.quantity != null
            ? displayNumber(
                String(row.remaining ?? row.outstanding ?? row.quantity),
              ) +
              " " +
              String(row.unit || "")
            : "",
        ]
          .filter(Boolean)
          .join(" · ") ||
        row.id,
    );
  }
  const rows = field.local
    ? local.filter((row) => label(row).toLowerCase().includes(q.toLowerCase()))
    : result.data.rows;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            id={id || generated}
            disabled={disabled}
            role="combobox"
            aria-expanded={open}
            aria-controls={generated + "-options"}
            aria-invalid={invalid || undefined}
            className="work-reference"
            aria-label={field.label}
          />
        }
      >
        <span>
          {record
            ? label(record)
            : value
              ? "Loading selection…"
              : "Choose " + field.label.toLowerCase()}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0" />
      </PopoverTrigger>
      <PopoverContent align="start" className="work-picker">
        <div className="work-picker-search">
          <Search className="size-4" />
          <Input
            autoFocus
            placeholder={"Search " + field.label.toLowerCase() + "…"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {!field.local && result.loading ? (
          <RecordSkeleton compact label="Loading choices…" />
        ) : result.error ? (
          <div role="alert">
            {result.error}
            <Button variant="outline" size="sm" onClick={result.refresh}>
              Retry
            </Button>
          </div>
        ) : (
          <div
            id={generated + "-options"}
            className="work-picker-options"
            role="listbox"
            aria-label={field.label}
          >
            {!rows.length && <p>No matching records.</p>}
            {rows.map((row) => (
              <button
                type="button"
                key={row.id}
                role="option"
                aria-selected={String(row[field.pick || "id"]) === value}
                onClick={() => {
                  setChosen(row);
                  onChange(String(row[field.pick || "id"]), row);
                  setOpen(false);
                }}
              >
                <span>
                  <strong>{label(row)}</strong>
                  <small>
                    {[
                      row.state ? humanLabel(String(row.state)) : "",
                      row.available != null
                        ? "Available " +
                          displayNumber(String(row.available)) +
                          " " +
                          (row.unit || "")
                        : "",
                      row.expiry_date ? "Expires " + row.expiry_date : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
                {String(row[field.pick || "id"]) === value && (
                  <Check className="size-4" />
                )}
              </button>
            ))}
          </div>
        )}
        <div className="work-picker-footer">
          <Button
            size="sm"
            variant="ghost"
            disabled={!value}
            onClick={() => {
              setChosen(null);
              onChange("");
              setOpen(false);
            }}
          >
            Clear
          </Button>
          {!field.local && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={page === 1 || result.loading}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span>{page}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={page * 50 >= result.data.total || result.loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
