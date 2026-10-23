"use client";
import { useEffect, useState } from "react";
import { requestTimeout } from "@/lib/request-timeout";
import type { WorkRow } from "@/lib/operations/catalog";
export function useWorkRecords(
  entity: string,
  query: Record<string, unknown> = {},
  enabled = true,
) {
  const [version, setVersion] = useState(0),
    [response, setResponse] = useState<{
      key: string;
      data?: {
        rows: WorkRow[];
        total: number;
        page: number;
        page_size: number;
        summary?: { field: string; unit: string; total: string }[];
      };
      error?: string;
    } | null>(null);
  const key = JSON.stringify([entity, query, version, enabled]);
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    const timeout = requestTimeout(abort.signal);
    const params = new URLSearchParams();
    for (const [fieldKey, value] of Object.entries(JSON.parse(key)[1]))
      if (value != null)
        params.set(
          fieldKey,
          typeof value === "object" ? JSON.stringify(value) : String(value),
        );
    void fetch("/api/operations/" + entity + "?" + params, {
      signal: timeout.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok)
          throw Error(data.message || "Could not load this workspace.");
        if (!abort.signal.aborted) setResponse({ key, data });
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setResponse({
            key,
            error:
              error instanceof Error
                ? error.message
                : "Could not load records.",
          });
      })
      .finally(timeout.dispose);
    return () => {
      abort.abort();
      timeout.dispose();
    };
  }, [key, entity, enabled]);
  const current = response?.key === key ? response : null;
  return {
    loading: enabled && !current,
    error: current?.error,
    data: current?.data || {
      rows: [],
      total: 0,
      page: Number(query.page) || 1,
      page_size: 50,
      summary: [],
    },
    refresh: () => setVersion((v) => v + 1),
  };
}
