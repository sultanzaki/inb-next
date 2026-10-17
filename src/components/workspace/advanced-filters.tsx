"use client";
import { useId } from "react";
import { CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { AdvancedFilters, ModuleName } from "@/lib/query-filters";
export type FilterProduct = {
  id: string;
  kode_produk: string;
  nama_produk: string;
};
export const filterTitles: Record<ModuleName, string> = {
  produk: "Filter products",
  inspeksi: "Filter inspections",
  coa: "Filter COAs",
  arsip: "Filter documents",
  audit: "Filter activity",
};
export function AdvancedFilterFields({
  value,
  onChange,
  module,
  products,
  productError,
}: {
  value: AdvancedFilters;
  onChange: (value: AdvancedFilters) => void;
  module: ModuleName;
  products: FilterProduct[];
  productError: boolean;
}) {
  const id = useId();
  return (
    <div className="advanced-filter-fields">
      <fieldset className="filter-date-range">
        <legend>
          <CalendarDays className="size-3.5" />
          Date range
        </legend>
        <div>
          <label htmlFor={id + "from"}>
            From
            <Input
              id={id + "from"}
              aria-label="From date"
              type="date"
              value={value.from}
              max={value.to || undefined}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
            />
          </label>
          <label htmlFor={id + "to"}>
            To
            <Input
              id={id + "to"}
              aria-label="To date"
              type="date"
              value={value.to}
              min={value.from || undefined}
              onChange={(e) => onChange({ ...value, to: e.target.value })}
            />
          </label>
        </div>
      </fieldset>
      {["inspeksi", "coa"].includes(module) && (
        <label htmlFor={id + "product"}>
          Product
          <select
            id={id + "product"}
            aria-label="Filter products"
            value={value.product}
            onChange={(e) => onChange({ ...value, product: e.target.value })}
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
        <label htmlFor={id + "person"}>
          {module === "audit" ? "Actor" : "Inspector"}
          <Input
            id={id + "person"}
            aria-label={
              module === "audit" ? "Filter actor" : "Filter inspector"
            }
            placeholder={module === "audit" ? "Actor name" : "Inspector name"}
            maxLength={100}
            value={value.person}
            onChange={(e) => onChange({ ...value, person: e.target.value })}
          />
        </label>
      )}
      {["produk", "arsip", "audit"].includes(module) && (
        <label htmlFor={id + "category"}>
          {module === "audit" ? "Action" : "Category"}
          <Input
            id={id + "category"}
            aria-label={
              module === "audit" ? "Filter actions" : "Filter category"
            }
            placeholder={module === "audit" ? "Exact action" : "Exact category"}
            maxLength={100}
            value={value.category}
            onChange={(e) => onChange({ ...value, category: e.target.value })}
          />
        </label>
      )}
    </div>
  );
}
