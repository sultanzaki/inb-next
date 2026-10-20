"use client";
import { useEffect, useState } from "react";
import type { ERPPage, ERPAction } from "@/lib/erp/schema";
export function useERPPage(
  entity: string,
  q = "",
  state = "",
  page = 1,
  id?: string,
  enabled = true,
  scope?: Record<string, unknown>,
) {
  const [version, setVersion] = useState(0),
    [response, setResponse] = useState<{
      key: string;
      data?: ERPPage;
      error?: string;
    } | null>(null);
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
  ]);
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    const timer = setTimeout(
      () => {
        const params = new URLSearchParams({ q, state, page: String(page) });
        if (id) params.set("id", id);
        if (entity.startsWith("choices/")) params.set("scope", scopeKey);
        void fetch("/api/erp/" + entity + "?" + params, {
          signal: abort.signal,
          cache: "no-store",
        })
          .then(async (r) => {
            const data = await r.json();
            if (!r.ok) throw Error(data.message || "Could not load records.");
            if (!abort.signal.aborted) setResponse({ key, data });
          })
          .catch((e) => {
            if (!abort.signal.aborted)
              setResponse({
                key,
                error:
                  e instanceof Error ? e.message : "Could not load records.",
              });
          });
      },
      q ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [key, entity, q, state, page, id, enabled, scopeKey]);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => setVersion((v) => v + 1);
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
  const r = await fetch("/api/erp/" + action, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!r.ok)
    throw new ERPRequestError(
      data.message || "Could not save changes.",
      data.fields || [],
    );
  return data as { id?: string; entity?: string };
}
