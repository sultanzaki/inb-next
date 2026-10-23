"use client";
import { useRef, type ReactNode } from "react";
import {
  Search,
  X,
  ArrowDownUp,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  FolderSearch,
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
        <p className="page-eyebrow">{eyebrow}</p>
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-description">{description}</p>}
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
            aria-label="Clear search"
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
          {loading ? "Loading…" : `${total.toLocaleString("en-GB")} records`}
        </span>
        {onOrder && (
          <label className="relative flex items-center gap-1.5">
            <ArrowDownUp className="pointer-events-none absolute left-3 size-3.5 text-muted" />
            <select
              aria-label="Sort records"
              value={order}
              onChange={(e) => onOrder(e.target.value)}
              className="!min-h-9 !py-1.5 !pl-8 !pr-2 !text-xs"
            >
              <option value="default">Default order</option>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
            </select>
          </label>
        )}
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Refresh data"
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
  page,
  pageSize,
  loading,
  onPageChange,
}: {
  count: number;
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1,
    last = Math.min(total, (page - 1) * pageSize + count);
  const numbers = [...new Set([1, page - 1, page, page + 1, pages])]
    .filter((p) => p > 0 && p <= pages)
    .sort((a, b) => a - b);
  return (
    <nav
      className="data-footer"
      aria-label="Table pagination"
      aria-busy={loading}
    >
      <span className="data-counter" aria-live="polite">
        {first.toLocaleString("en-GB")}–{last.toLocaleString("en-GB")} of{" "}
        <strong>{total.toLocaleString("en-GB")}</strong>
      </span>
      <div className="pagination-controls">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Previous page"
          disabled={loading || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="pagination-mobile">
          Page {page} of {pages}
        </span>
        <div className="pagination-numbers">
          {numbers.map((n, index) => (
            <span className="inline-flex items-center gap-1" key={n}>
              {index > 0 && n > numbers[index - 1] + 1 && (
                <span className="px-1 text-muted" aria-hidden="true">
                  …
                </span>
              )}
              <Button
                variant={n === page ? "default" : "ghost"}
                size="icon-sm"
                aria-label={"Page " + n}
                aria-current={n === page ? "page" : undefined}
                disabled={loading}
                onClick={() => onPageChange(n)}
              >
                {n}
              </Button>
            </span>
          ))}
        </div>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Next page"
          disabled={loading || page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </nav>
  );
}
