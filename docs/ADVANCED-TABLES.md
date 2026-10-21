# Table workbench

Primary record lists in Quality, Master data, Administration, Warehouse, Production, Sales, Purchase, CRM, Product documents, Finance and Service use the same table workbench. Nested document lines, fixed operating-policy summaries and calculation/reference tables keep their purpose-specific layout.

## Daily use

- Click a column title to cycle ascending → descending → default. Shift-click adds a sort priority (up to four). The Sort panel offers the same controls on mobile.
- Open a column’s options menu to sort, clear its sort, filter that field, pin it, or hide it. The record identity stays visible so document actions remain understandable.
- Filters use AND between conditions (up to twelve). Text supports contains, exact, starts with, exclusions and “is any of” (comma-separated values). Number/date fields use typed comparisons and empty/not-empty checks. Date presets apply to the first date column; the condition names make the chosen field explicit.
- Remove individual active-filter chips or reset the table. Existing module-specific date/product/status filters still apply alongside table conditions.
- Columns controls visibility, ordering, compact/comfortable rows, one pinned column and a page group summary. Drag a header divider to resize; keyboard arrows/Home/End work on the focused divider.
- Page grouping has collapsible groups and explicitly covers the current page. Filtered totals cover all matching records and remain separated by currency/unit. No sum is shown when its currency/unit is unknown. Decimal totals stay strings until display, preserving precision.
- Views saves search, status, advanced filter context, sorting and layout. Preferences and up to twenty views are stored per account/table in this browser. Share view copies a URL with filter/layout context; recipients still need normal module access. This is a shareable view link, not a permission grant or a centrally managed team view.
- CSV/Excel exports include all matching results, not just the visible page, and default to visible columns in their configured order. “Export all allowed columns” is available in Columns. The existing 10,000-record export limit fails explicitly without creating a partial file. Formula-like CSV values remain escaped; XLSX values are written as literal cells.
- Double-click a plain cell to copy its underlying value. Existing identifier copy controls and row actions are preserved.

Bulk actions and mass selection are deliberately absent. Business-document editing still uses the existing versioned forms and confirmation workflows; posted financial/inventory records are not made editable by table preferences.

## Deployment and query contract

Apply `src/lib/db/migrations/017_advanced_tables.sql` after 016 before deploying the application. It is transactional and repeatable. It adds the service-role-only `erp_table_read` RPC and private helpers. The migration inserts an advanced-query branch into the existing authorized ERP/Finance read-source functions after access checks and summary projection. A mismatched prerequisite definition aborts the whole migration rather than partially installing it. Future migrations that replace those read-source functions must retain this branch.

`src/lib/tables/schema.ts` is the allowlist for fields, types and limits. API input is validated before RPC/PostgREST execution. Sort/filter operations run before LIMIT/OFFSET and counts use the same predicates. Stable identity tie-breaks prevent duplicate rows across equal sort values. The backend never accepts client-provided SQL sources. Quality/user/audit reads use the same schema and PostgREST adapter, retaining their existing access gates.

CSV and XLSX exports reuse the same validated query contract. Hidden columns are presentation preferences, never an authorization mechanism. Existing blind-count and cross-module Finance/CRM restrictions remain in force.

## Verification

`npm test`, `npm run test:db`, `npm run test:http`, `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run test:e2e`. `TEST_TABLES_ONLY=1 npm run test:e2e` exercises filters, sorting, saved layout/views, filtered exports and mobile panels.
