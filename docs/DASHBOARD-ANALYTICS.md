# COA dates and dashboard analytics

## COA dates

New certificates require manufacturing and release dates. Expiry is displayed as an output, one calendar year after manufacturing. February 29 becomes February 28 in the following year. Release must fall between manufacturing and expiry.

The shared server validation derives expiry before preview, preview-proof verification, issuance, and updates with a manufacturing date. A submitted expiry cannot override the calculation. Previously issued PDFs retain their stored dates; existing records are not rewritten during deployment. Legacy updates without a manufacturing date retain their stored expiry. Delivery date is no longer an input; previously stored delivery metadata is preserved.

## One analytics panel, four views

- **Activity:** six intervals of PASS/FAIL inspections, based on test date. Select an interval for its exact counts.
- **Quality:** PASS/FAIL distribution and pass rate over the selected period. No inspections shows an unavailable rate, not 100%.
- **COAs:** certificate releases over the same six intervals, based on release date. Select a date label for its count.
- **Documents:** current valid, expiring within the next 30 days, and expired documents. Expiring documents are a subset of valid documents; the chart separates them. The period selector is disabled for this current-status view.

Activity, Quality, and COAs support rolling 30/90-day windows, including today, using Jakarta business dates. There is no automatic carousel rotation. Tabs support keyboard navigation; graphs have text labels and an expandable data table. Layout stacks the readout and graph on mobile. Existing reduced-motion preferences apply.

The authenticated `/api/dashboard/analytics` endpoint returns exact database counts, not record rows. It performs 21 bounded count queries with at most four in flight. Invalid periods return 400, missing sessions 401, and query failures 503. Responses are private and not cached. The UI shows Retry rather than presenting failed counts as zero.

The three summary KPIs use a shared desktop value column and equal-height mobile labels, keeping the values aligned when labels wrap.

## Validation

Use `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and the existing `npm run test:e2e` runner against disposable local services. Coverage includes leap dates, server expiry normalization, release bounds, gap-free analytics intervals, exact count comparison with PostgreSQL, API authentication, failure/retry, tab/period controls, accessible mobile layouts, KPI alignment, and saved COA expiry.

No new dependency or database migration is required.
