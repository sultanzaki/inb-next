# Operator workflow reliability

## Behavior

- Table toolbars wrap at narrow widths. Filter drawers use the available screen height with a scrollable body and room for the close button.
- ERP and operations reads share concurrent identical requests. Workspaces wait for stored table preferences and work position before loading lists. This is request deduplication, not a stale cache of stock or financial balances.
- ERP and operations forms keep device-local recovery snapshots per account, workspace, record and form. Recovery is explicit, expires after seven days, and clears after successful submission or deliberate discard. Restored data is validated again on submission. QC inspection server drafts remain unchanged; account/password forms are excluded.
- A snapshot is not a posted transaction or a server draft. It is not synced across devices. Browser storage failures are nonblocking and visible in the form. Use trusted devices for operational data.
- Save status distinguishes active submission, validation rejection and an unknown outcome (network interruption, timeout, server error or unreadable response). Unknown outcomes disable resubmission until the operator acknowledges checking the record/history. No write is automatically retried; existing idempotency keys are preserved where supported.
- Long operational forms have Details, Items/Notes and Review steps. ERP forms split primary/additional details or items/terms. All fields remain mounted, preserving edits and reference selections. Final submission performs validation; errors reveal all fields. Operators can choose All fields mode.
- ERP, growth, finance/service and operations lists restore search, status, page and scroll position within the browser session. Explicit URL search/page/filter state takes precedence. Existing saved column/filter layouts remain separate. User scrolling cancels automatic scroll restoration.

## Validation

The targeted browser exercise in `tests/operator-workflow-browser.ts` covers guided formulas and quotations, reload/recovery/discard, field validation, unknown save outcomes without automatic retry, narrow toolbars/filter drawers, and restoring list search and page two. The full existing browser suite also exercises transaction flows in All fields mode. Unit coverage verifies known versus uncertain save errors and request sharing/cancellation.

No schema migration is required. Production latency has not been benchmarked; request reduction does not remove database/network latency.
