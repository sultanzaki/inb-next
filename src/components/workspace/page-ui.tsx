"use client";
import { useRef, type ReactNode } from "react";
import {
  Search,
  X,
  ArrowDownUp,
  RotateCw,
  ChevronDown,
  FolderSearch,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <p className="page-eyebrow">
          <span className="size-1.5 rounded-full bg-primary" />
          {eyebrow}
        </p>
        <h1 className="page-title">{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}
export function DataToolbar({
  search,
  onSearch,
  placeholder,
  total,
  loading,
  onRefresh,
  filter,
  order,
  onOrder,
}: {
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  total: number;
  loading: boolean;
  onRefresh: () => void;
  filter?: ReactNode;
  order?: string;
  onOrder?: (value: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="data-toolbar">
      <div className="search-field">
        <Search />
        <Input
          ref={ref}
          data-search-input
          aria-label={placeholder}
          placeholder={placeholder}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        {search ? (
          <button
            className="search-clear"
            type="button"
            aria-label="Hapus pencarian"
            onClick={() => {
              onSearch("");
              ref.current?.focus();
            }}
          >
            <X className="size-3.5" />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
            /
          </kbd>
        )}
      </div>
      <div className="data-toolbar-meta">
        {filter}
        <span className="sr-only sm:not-sr-only" aria-live="polite">
          {loading ? "Memuat…" : `${total.toLocaleString("id-ID")} data`}
        </span>
        {onOrder && (
          <label className="relative flex items-center gap-1.5">
            <ArrowDownUp className="pointer-events-none absolute left-3 size-3.5 text-muted" />
            <select
              aria-label="Urutkan data"
              value={order}
              onChange={(e) => onOrder(e.target.value)}
              className="!min-h-9 !py-1.5 !pl-8 !pr-2 !text-xs"
            >
              <option value="default">Urutan default</option>
              <option value="newest">Terbaru</option>
              <option value="oldest">Terlama</option>
            </select>
          </label>
        )}
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Muat ulang data"
          onClick={onRefresh}
          disabled={loading}
        >
          <RotateCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>
    </div>
  );
}
export function FilterTabs({
  value,
  onChange,
  items,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  items: { value: string; label: string }[];
  label: string;
}) {
  return (
    <div className="segmented-control" role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={value === item.value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  children,
  error = false,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  error?: boolean;
}) {
  return (
    <div className="empty-state" role={error ? "alert" : undefined}>
      <span
        className="empty-icon"
        style={
          error
            ? {
                background: "var(--color-danger-bg)",
                color: "var(--color-danger)",
              }
            : undefined
        }
      >
        <FolderSearch className="size-6" />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}
export function DataPagination({
  count,
  total,
  loading,
  onMore,
}: {
  count: number;
  total: number;
  loading: boolean;
  onMore: () => void;
}) {
  return (
    <div className="data-footer">
      <span className="data-counter">
        Menampilkan{" "}
        <strong className="font-medium text-text">
          {count.toLocaleString("id-ID")}
        </strong>{" "}
        dari{" "}
        <strong className="font-medium text-text">
          {total.toLocaleString("id-ID")}
        </strong>{" "}
        data
      </span>
      {count < total ? (
        <Button variant="outline" size="sm" onClick={onMore} disabled={loading}>
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
          {loading ? "Memuat…" : `Muat lagi (${total - count} tersisa)`}
        </Button>
      ) : (
        <span className="text-[11px] text-muted">
          Semua data sudah ditampilkan
        </span>
      )}
    </div>
  );
}
