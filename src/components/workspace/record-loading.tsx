"use client";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
type LoadingRegistry = {
  report: (id: string, pending: boolean) => void;
  remove: (id: string) => void;
};
const Registry = createContext<LoadingRegistry | null>(null);
/** Register dependent reads while the record's initial presentation is assembled. */
export function useRecordLoading(pending: boolean, enabled = true) {
  const registry = useContext(Registry),
    id = useId();
  useEffect(() => {
    if (!registry || !enabled) return;
    registry.report(id, pending);
    return () => registry.remove(id);
  }, [registry, id, pending, enabled]);
}
export function RecordSkeleton({
  label = "Loading record details…",
  compact = false,
}: {
  label?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`record-skeleton${compact ? " is-compact" : ""}`}
      role="status"
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        <div className="record-skeleton-heading" />
        <div className="record-skeleton-fields">
          {Array.from({ length: compact ? 2 : 6 }, (_, i) => (
            <div key={i}>
              <span />
              <span />
            </div>
          ))}
        </div>
        <div className="record-skeleton-lines">
          {Array.from({ length: compact ? 2 : 4 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
export function RecordLoadingBoundary({
  loading = false,
  children,
}: {
  loading?: boolean;
  children: ReactNode;
}) {
  const pending = useRef(new Map<string, boolean>()),
    [revision, bump] = useReducer((v) => v + 1, 0),
    [revealed, setRevealed] = useState(false);
  const registry = useMemo<LoadingRegistry>(
    () => ({
      report(id, value) {
        if (pending.current.get(id) !== value) {
          pending.current.set(id, value);
          bump();
        }
      },
      remove(id) {
        if (pending.current.delete(id)) bump();
      },
    }),
    [],
  );
  useEffect(() => {
    if (loading || revealed || [...pending.current.values()].some(Boolean))
      return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (![...pending.current.values()].some(Boolean)) setRevealed(true);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [loading, revealed, revision]);
  const busy = loading || !revealed;
  return (
    <Registry value={registry}>
      <div className="record-loading-boundary" aria-busy={busy}>
        {busy && <RecordSkeleton />}
        <div hidden={busy} className="record-ready-content">
          {children}
        </div>
      </div>
    </Registry>
  );
}
