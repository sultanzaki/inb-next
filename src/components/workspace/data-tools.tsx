"use client";
import { useFileDownload } from "./use-file-download";
import { useEffect, useEffectEvent, useState } from "react";
import {
  Copy,
  Check,
  Download,
  SlidersHorizontal,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useMobile } from "@/hooks/use-mobile";
import { AdvancedFilterFields, filterTitles } from "./advanced-filters";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
  tableControlled = false,
  module,
  search,
  filter,
  order,
  filters,
  onFilters,
  loading,
}: {
  tableControlled?: boolean;
  module: ModuleName;
  search: string;
  filter: string;
  order: string;
  filters: AdvancedFilters;
  onFilters: (v: AdvancedFilters) => void;
  loading: boolean;
}) {
  const mobile = useMobile();
  const [desktopOpen, setDesktopOpen] = useState(false),
    [mobileOpen, setMobileOpen] = useState(false),
    [draft, setDraft] = useState<AdvancedFilters>({ ...filters });
  const { busy: exporting, download: downloadFile } = useFileDownload();
  const open = mobile ? mobileOpen : desktopOpen;
  function toggle() {
    if (mobile) {
      setDraft({ ...filters });
      setMobileOpen((v) => !v);
    } else setDesktopOpen((v) => !v);
  }
  const invalidRange = Boolean(draft.from && draft.to && draft.from > draft.to);
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
    await downloadFile(
      "/api/export?" +
        new URLSearchParams({
          module,
          search,
          filter,
          order,
          ...filters,
          format,
        }),
      `${module}.${format}`,
      format,
    );
  }

  return (
    <div className="data-tools">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" aria-expanded={open} onClick={toggle}>
          <SlidersHorizontal className="size-3.5" />
          Advanced filters
          {count > 0 && <span className="filter-count">{count}</span>}
        </Button>
        {!tableControlled && (
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
                aria-busy={exporting === format || undefined}
                onClick={() => void download(format)}
              >
                {exporting === format ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Download className="size-3.5" />
                )}
                {exporting === format
                  ? "Preparing…"
                  : format === "xlsx"
                    ? "Excel"
                    : "CSV"}
              </Button>
            ))}
          </div>
        )}
      </div>
      {!mobile && desktopOpen && (
        <div className="advanced-filter-panel">
          <AdvancedFilterFields
            value={filters}
            onChange={onFilters}
            module={module}
            products={products}
            productError={productError}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onFilters({ ...emptyFilters })}
          >
            <RotateCcw className="size-3.5" />
            Clear filters
          </Button>
        </div>
      )}
      <Sheet open={mobile && mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="bottom" className="filter-sheet">
          <div className="sheet-grip" aria-hidden="true" />
          <SheetHeader>
            <SheetTitle>{filterTitles[module]}</SheetTitle>
            <SheetDescription>Filters also apply to exports.</SheetDescription>
          </SheetHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (invalidRange) return;
              onFilters({ ...draft });
              setMobileOpen(false);
            }}
          >
            <div className="filter-sheet-body">
              <AdvancedFilterFields
                value={draft}
                onChange={setDraft}
                module={module}
                products={products}
                productError={productError}
              />
              {invalidRange && (
                <p role="alert" className="mt-3 text-xs text-danger">
                  End date must not be before start date.
                </p>
              )}
            </div>
            <div className="filter-sheet-footer">
              <Button
                variant="outline"
                onClick={() => {
                  setDraft({ ...emptyFilters });
                  onFilters({ ...emptyFilters });
                  setMobileOpen(false);
                }}
              >
                <RotateCcw className="size-3.5" />
                Clear
              </Button>
              <Button type="submit" disabled={invalidRange}>
                Apply filters
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
export { emptyFilters };
export type { AdvancedFilters };
