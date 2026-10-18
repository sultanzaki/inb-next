"use client";
import {
  createContext,
  useCallback,
  useMemo,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { ERPContext, ModuleKey } from "@/lib/erp/schema";
type Value = {
  data: ERPContext | null;
  error: string;
  refresh: () => void;
  can: (module: ModuleKey, verb?: "read" | "write" | "approve") => boolean;
};
const Context = createContext<Value>({
  data: null,
  error: "",
  refresh: () => {},
  can: () => false,
});
export function ERPProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ERPContext | null>(null),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/erp/context", { signal: abort.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw Error("Workspace configuration unavailable. Retry.");
        const value = await r.json();
        if (!abort.signal.aborted) {
          setData(value);
          setError("");
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : "Workspace unavailable.");
      });
    return () => abort.abort();
  }, [version]);
  const can = useCallback(
    (module: ModuleKey, verb: "read" | "write" | "approve" = "read") => {
      const entry = data?.modules.find((m) => m.key === module);
      return Boolean(
        entry &&
        entry.state !== "disabled" &&
        (verb === "read" || entry.state === "active") &&
        entry[verb],
      );
    },
    [data],
  );
  const value = useMemo(
    () => ({ data, error, refresh, can }),
    [data, error, refresh, can],
  );
  return <Context value={value}>{children}</Context>;
}
export const useERP = () => useContext(Context);
