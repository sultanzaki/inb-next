"use client";
import { useEffect, useEffectEvent, useState } from "react";
import {
  Copy,
  Check,
  Download,
  SlidersHorizontal,
  Loader2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  emptyFilters,
  type AdvancedFilters,
  type ModuleName,
} from "@/lib/query-filters";

export function CopyValue({
  value,
  label = "Copy identifier",
  menuItem = false,
}: {
  value: string;
  label?: string;
  menuItem?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied.");
    } catch {
      toast.error("Could not copy. Select and copy the text manually.");
    }
  }
  if (menuItem)
    return (
      <DropdownMenuItem onClick={() => void copy()}>
        <Copy className="size-3.5" />
        {label}
      </DropdownMenuItem>
    );
  return (
    <button
      type="button"
      className="copy-value"
      aria-label={copied ? "Copied" : label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        void copy();
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}
export function useSearchSeed(callback: (q: string) => void) {
  const apply = useEffectEvent(callback);
  useEffect(() => {
    const timer = setTimeout(() => {
      const q = new URLSearchParams(window.location.search).get("q");
      if (q) apply(q);
    }, 0);
    const listen = (e: Event) => apply((e as CustomEvent<string>).detail);
    window.addEventListener("workspace:query", listen);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("workspace:query", listen);
    };
  }, []);
}
export function DataTools({
  module,
  search,
  filter,
  order,
  filters,
  onFilters,
  loading,
}: {
  module: ModuleName;
  search: string;
  filter: string;
  order: string;
  filters: AdvancedFilters;
  onFilters: (v: AdvancedFilters) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false),
    [exporting, setExporting] = useState("");
  const count = Object.values(filters).filter(Boolean).length;
  const [products, setProducts] = useState<
    { id: string; kode_produk: string; nama_produk: string }[]
  >([]);
  const [productError, setProductError] = useState(false);
  useEffect(() => {
    if (!open || !["inspeksi", "coa"].includes(module)) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const list: { id: string; kode_produk: string; nama_produk: string }[] =
          [];
        for (let offset = 0; ; offset += 500) {
          const r = await fetch(
            "/api/data/master_produk?" +
              new URLSearchParams({
                select: "id,kode_produk,nama_produk",
                order: "nama_produk.asc,id.asc",
                offset: String(offset),
                limit: "500",
              }),
            { signal: controller.signal },
          );
          if (!r.ok) throw Error();
          const rows = await r.json();
          list.push(...rows);
          if (rows.length < 500) break;
        }
        if (!controller.signal.aborted) {
          setProducts(list);
          setProductError(false);
        }
      } catch {
        if (!controller.signal.aborted) setProductError(true);
      }
    })();
    return () => controller.abort();
  }, [open, module]);
  async function download(format: "csv" | "xlsx") {
    setExporting(format);
    try {
      const r = await fetch(
        "/api/export?" +
          new URLSearchParams({
            module,
            search,
            filter,
            order,
            ...filters,
            format,
          }),
      );
      if (!r.ok) {
        const e = await r.json();
        throw Error(e.message || "Export failed.");
      }
      const blob = await r.blob(),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `${module}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast.success("Export ready.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting("");
    }
  }
  return (
    <div className="data-tools">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <SlidersHorizontal className="size-3.5" />
          Advanced filters
          {count > 0 && <span className="filter-count">{count}</span>}
        </Button>
        <div className="flex items-center gap-2">
          <span className="hidden text-[11px] text-muted sm:inline">
            Export filtered results
          </span>
          {(["csv", "xlsx"] as const).map((format) => (
            <Button
              key={format}
              variant="outline"
              size="sm"
              disabled={loading || Boolean(exporting)}
              onClick={() => void download(format)}
            >
              {exporting === format ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              {format === "xlsx" ? "Excel" : "CSV"}
            </Button>
          ))}
        </div>
      </div>
      {open && (
        <div className="advanced-filter-panel">
          <label>
            From date
            <Input
              aria-label="From date"
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(e) => onFilters({ ...filters, from: e.target.value })}
            />
          </label>
          <label>
            To date
            <Input
              aria-label="To date"
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(e) => onFilters({ ...filters, to: e.target.value })}
            />
          </label>
          {["inspeksi", "coa"].includes(module) && (
            <label>
              Products
              <select
                aria-label="Filter products"
                value={filters.product}
                onChange={(e) =>
                  onFilters({ ...filters, product: e.target.value })
                }
              >
                <option value="">All products</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.kode_produk} · {p.nama_produk}
                  </option>
                ))}
              </select>
              {productError && (
                <span role="alert" className="text-danger">
                  Could not load products. Reopen the filters to retry.
                </span>
              )}
            </label>
          )}
          {["inspeksi", "audit"].includes(module) && (
            <label>
              {module === "audit" ? "Actor" : "Inspector"}
              <Input
                aria-label={
                  module === "audit" ? "Filter actor" : "Filter inspector"
                }
                placeholder={
                  module === "audit" ? "Actor name" : "Inspector name"
                }
                value={filters.person}
                onChange={(e) =>
                  onFilters({ ...filters, person: e.target.value })
                }
              />
            </label>
          )}
          {["produk", "arsip", "audit"].includes(module) && (
            <label>
              {module === "audit" ? "Actions" : "Category"}
              <Input
                aria-label={
                  module === "audit" ? "Filter actions" : "Filter category"
                }
                placeholder={
                  module === "audit" ? "Exact action" : "Exact category"
                }
                value={filters.category}
                onChange={(e) =>
                  onFilters({ ...filters, category: e.target.value })
                }
              />
            </label>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onFilters({ ...emptyFilters })}
          >
            <X className="size-3.5" />
            Clear advanced filters
          </Button>
        </div>
      )}
    </div>
  );
}
export { emptyFilters };
export type { AdvancedFilters };
