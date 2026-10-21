"use client";
import { invalidateERPReads, readERPPage } from "@/lib/erp/read-request";
import { useEffect, useRef, useState } from "react";
import { entityColumns, type TableQuery } from "@/lib/tables/schema";
import type { ERPPage, ERPAction } from "@/lib/erp/schema";
export function useERPPage(
  entity: string,
  q = "",
  state = "",
  page = 1,
  id?: string,
  enabled = true,
  scope?: Record<string, unknown>,
  tableQuery?: TableQuery,
) {
  const [version, setVersion] = useState(0),
    [response, setResponse] = useState<{
      key: string;
      data?: ERPPage;
      error?: string;
    } | null>(null);
  const gridKey =
    tableQuery && entityColumns[entity] ? JSON.stringify(tableQuery) : "";
  const scopeKey = JSON.stringify(scope || {});
  const key = JSON.stringify([
    entity,
    q,
    state,
    page,
    id,
    version,
    enabled,
    scopeKey,
    gridKey,
  ]);
  const lastRead = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    const timer = setTimeout(
      () => {
        const params = new URLSearchParams({ q, state, page: String(page) });
        if (gridKey) params.set("grid", gridKey);
        if (id) params.set("id", id);
        if (entity.startsWith("choices/")) params.set("scope", scopeKey);
        lastRead.current = Date.now();
        void readERPPage("/api/erp/" + entity + "?" + params, abort.signal)
          .then((data) => {
            if (!abort.signal.aborted) setResponse({ key, data });
          })
          .catch((e) => {
            if (!abort.signal.aborted)
              setResponse({
                key,
                error:
                  e instanceof Error && e.name === "TimeoutError"
                    ? "Loading took too long. Retry this record."
                    : e instanceof Error
                      ? e.message
                      : "Could not load records.",
              });
          });
      },
      q && !id ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [key, entity, q, state, page, id, enabled, scopeKey, gridKey]);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastRead.current >= 30_000
      )
        setVersion((v) => v + 1);
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [enabled]);
  const current = response?.key === key ? response : null;
  return {
    data: current?.data ?? { rows: [], total: 0, page, page_size: 50 },
    error: current?.error,
    loading: enabled && !current,
    refresh: () => setVersion((v) => v + 1),
  };
}
export class ERPRequestError extends Error {
  constructor(
    message: string,
    public fields: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}
export async function erpAction(action: ERPAction, payload: unknown) {
  invalidateERPReads();
  const r = await fetch("/api/erp/" + action, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  invalidateERPReads();
  if (!r.ok)
    throw new ERPRequestError(
      data.message || "Could not save changes.",
      data.fields || [],
    );
  return data as { id?: string; entity?: string };
}
