"use client";
import { useEffect, useState } from "react";
import { useUser } from "@/app/(dashboard)/user-context";
import {
  emptyQuery,
  entityColumns,
  parseTableQuery,
  type TableQuery,
} from "@/lib/tables/schema";
export type Layout = {
  hidden: string[];
  order: string[];
  widths: Record<string, number>;
  pinned: string[];
  density: "compact" | "comfortable";
  group: string;
};
export type SavedView = {
  id: string;
  name: string;
  query: TableQuery;
  layout: Layout;
  search: string;
  state: string;
  context?: Record<string, string>;
};
function normalizeLayout(
  raw: Partial<Layout> | undefined,
  fallback: Layout,
): Layout {
  const keys = new Set(fallback.order);
  return {
    density: raw?.density === "compact" ? "compact" : "comfortable",
    hidden: Array.isArray(raw?.hidden)
      ? raw.hidden.filter((k) => keys.has(k) && k !== fallback.order[0])
      : fallback.hidden,
    order: Array.isArray(raw?.order)
      ? raw.order.filter((k) => keys.has(k))
      : fallback.order,
    pinned: Array.isArray(raw?.pinned)
      ? raw.pinned.filter((k) => keys.has(k)).slice(0, 1)
      : [],
    group: raw?.group && keys.has(raw.group) ? raw.group : "",
    widths: Object.fromEntries(
      Object.entries(raw?.widths || {})
        .filter(([k, v]) => keys.has(k) && Number.isFinite(v))
        .map(([k, v]) => [k, Math.max(100, Math.min(480, v))]),
    ),
  };
}
export function useTableState(entity: string, onQueryChange?: () => void) {
  const { user } = useUser();
  const columns = entityColumns[entity] || [];
  const initialLayout: Layout = {
    hidden: columns.filter((c) => c.hidden).map((c) => c.key),
    order: columns.map((c) => c.key),
    widths: {},
    pinned: [],
    density: "comfortable",
    group: "",
  };
  const key = `inb:table:2:${user?.id || "session"}:${entity}`;
  const [stored, setStored] = useState<{
    key: string;
    query: TableQuery;
    layout: Layout;
    views: SavedView[];
  } | null>(null);
  const current =
    stored?.key === key
      ? stored
      : { key, query: emptyQuery, layout: initialLayout, views: [] };
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const raw = localStorage.getItem(key);
        const data = raw ? JSON.parse(raw) : null;
        const url = new URLSearchParams(window.location.search);
        const shared = url.get("table") === entity ? url.get("grid") : null;
        setStored({
          key,
          query: parseTableQuery(
            shared || JSON.stringify(data?.query || {}),
            entity,
          ),
          layout: normalizeLayout(
            shared && url.get("gridLayout")
              ? JSON.parse(url.get("gridLayout")!)
              : data?.layout,
            initialLayout,
          ),
          views: Array.isArray(data?.views) ? data.views.slice(0, 20) : [],
        });
      } catch {
        setStored({ key, query: emptyQuery, layout: initialLayout, views: [] });
      }
    }, 0);
    return () => clearTimeout(timer);
    // Layout defaults depend on the entity, never on render identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (stored?.key === key) {
      try {
        localStorage.setItem(key, JSON.stringify(stored));
      } catch {
        /* Preferences can remain in memory when storage is unavailable. */
      }
    }
  }, [stored, key]);
  function update(next: Partial<typeof current>, queryChanged = false) {
    const value = { ...current, ...next };
    setStored((previous) => ({
      ...(previous?.key === key ? previous : current),
      ...next,
    }));
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* Storage may be unavailable in private browsing. */
    }
    if (queryChanged) {
      onQueryChange?.();
      const url = new URL(window.location.href);
      url.searchParams.set("table", entity);
      url.searchParams.set("grid", JSON.stringify(value.query));
      url.searchParams.delete("page");
      window.history.replaceState(null, "", url);
    }
  }
  return {
    entity,
    ready: stored?.key === key,
    columns,
    query: current.query,
    layout: current.layout,
    views: current.views,
    setQuery: (query: TableQuery) => update({ query }, true),
    setLayout: (change: Layout | ((layout: Layout) => Layout)) =>
      setStored((previous) => {
        const base = previous?.key === key ? previous : current;
        return {
          ...base,
          layout: typeof change === "function" ? change(base.layout) : change,
        };
      }),
    saveView: (
      name: string,
      search = "",
      state = "",
      context: Record<string, string> = {},
    ) =>
      update({
        views: [
          ...current.views,
          {
            id: crypto.randomUUID(),
            name,
            query: current.query,
            layout: current.layout,
            search,
            state,
            context,
          },
        ].slice(-20),
      }),
    deleteView: (id: string) =>
      update({ views: current.views.filter((v) => v.id !== id) }),
    applyView: (view: SavedView) =>
      update(
        {
          query: parseTableQuery(JSON.stringify(view.query), entity),
          layout: normalizeLayout(view.layout, initialLayout),
        },
        true,
      ),
    reset: () => update({ query: emptyQuery, layout: initialLayout }, true),
  };
}
export type TableState = ReturnType<typeof useTableState>;
