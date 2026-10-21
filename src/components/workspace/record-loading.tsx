"use client";
import type { ReactNode } from "react";
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
/** Keep primary data and independent section loading separate. */
export function RecordLoadingBoundary({
  loading = false,
  children,
}: {
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="record-loading-boundary" aria-busy={loading}>
      {loading && <RecordSkeleton />}
      <div hidden={loading} className="record-ready-content">
        {children}
      </div>
    </div>
  );
}
