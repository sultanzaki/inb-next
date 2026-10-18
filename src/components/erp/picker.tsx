"use client";
import { useState } from "react";
import {
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
} from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useERPPage } from "./data";
import type { ERPRow } from "@/lib/erp/schema";
export function ERPPicker({
  entity,
  label,
  value,
  onChange,
  filterProduct,
  hideLabel = false,
}: {
  entity: string;
  label: string;
  value: ERPRow | null;
  onChange: (row: ERPRow) => void;
  filterProduct?: string;
  hideLabel?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1);
  const result = useERPPage(
    filterProduct ? "availability" : entity,
    q,
    "",
    page,
    filterProduct,
    open,
  );
  const rows = filterProduct
    ? result.data.rows.filter((r) => r.product_id === filterProduct)
    : result.data.rows;
  return (
    <div className="erp-picker">
      {!hideLabel && <span className="erp-label">{label}</span>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="erp-picker-trigger"
              aria-label={label}
            />
          }
        >
          {value?.label ||
            value?.name ||
            value?.number ||
            value?.product ||
            "Select…"}
          <ChevronDown className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent className="erp-picker-panel" align="start">
          <div className="erp-picker-search">
            <Search className="size-3.5" />
            <Input
              aria-label={"Search " + label}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Search…"
            />
          </div>
          <div className="erp-picker-results">
            {result.loading ? (
              <p role="status">Loading…</p>
            ) : result.error ? (
              <p role="alert">{result.error}</p>
            ) : rows.length === 0 ? (
              <p>No matches on this page.</p>
            ) : (
              rows.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    onChange(r);
                    setOpen(false);
                  }}
                >
                  <span>{r.label || r.name || r.number || r.product}</span>
                  {r.id === value?.id && <Check className="size-3.5" />}
                </button>
              ))
            )}
          </div>
          <div className="erp-picker-pages">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Previous options"
              disabled={page === 1 || result.loading}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft />
            </Button>
            <span>
              Page {page} · {result.data.total} options
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Next options"
              disabled={result.loading || page * 50 >= result.data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
