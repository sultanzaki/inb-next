# Performance and canonical routes

## Rollout

Apply `008_performance_routes.sql` after **007**, then deploy this application. The new RPCs enable the database/query improvements. Session, summary, analytics and search readers include a missing-function fallback for staged rollout, so deploying the app before 008 does not break existing workflows. Fallbacks keep module/session authorization and avoid the retired archive. Other database/network/permission errors never activate those fallbacks. The live Supabase project is not changed by local validation.

Migration 008 is transactional and repeatable; it preserves business records, historical archive records, credentials and permissions. Index creation takes locks: schedule a quiet deployment window. For a substantially larger installation, have the database operator build the named indexes with `CREATE INDEX CONCURRENTLY` outside a transaction first; the migration skips existing names. `pg_trgm` is installed in `extensions` when absent, and its existing schema is discovered when already installed. Historical migrations remain unchanged.

## Changes and practical limits

| Path | Previous database requests, excluding authentication | Current |
| --- | --- | --- |
| Quality analytics | 18 interval counts plus 3 legacy archive counts | 1 RPC; aggregates inspection and certificate periods, no archive reads |
| Quality overview | 8 separate reads | 1 RPC; inspection counts share a scan and recent records omit test-result payloads |
| Global search, all modules enabled | Up to 13 context/collection reads, with full ERP row details | 1 RPC; authorized, limited summary projections from source tables |
| Session identity and effective actions | 3 sequential reads | 1 RPC; React `cache` deduplicates repeated identity reads within a server render |

Authorization and module-mode checks remain server-side and inside the SQL RPCs. Only service_role can execute these RPCs. Forced-password users receive no effective operational actions. Expired/inactive sessions cannot return identity; role/access revocation remains immediate in subsequent requests. There is no shared cross-user business-data or permission cache, and no localStorage business cache. API responses retain `private, no-store`. Hashed Next.js static assets retain the framework's immutable caching.

UI fonts use the same licensed DM Sans glyphs compressed losslessly to WOFF2: **244,212 bytes → 98,324 bytes (59.7% smaller)** across all five files. Original TTFs remain for PDF embedding. Chart code loads in a separate dynamic chunk. PDF renderers load only in ERP document branches, rather than on ordinary ERP list requests. Quality overview no longer imports the large general ERP workspace as a fallback; its parent module gate handles access. ERP context values are memoized to avoid incidental context propagation. The read-only data gateway streams upstream response bodies instead of allocating a second complete text buffer. Nested Quality routes share their parent module gate rather than repeating it.

New indexes target test/release dates, recent inspection order, session cleanup, material transaction traceability, product document history, lot expiry and existing product/lot/certificate substring searches. Large JSON payloads are not indexed. Exact totals and existing bounded pagination are retained. Expensive deep offset pages, very short search terms and broad matches can still cost more; monitor actual production workload before adding more indexes or introducing a search service.

## Reproducible local query check

After `npm run test:db`, run `npx tsx scripts/benchmark-search.ts`. It targets only the disposable local database at port 55432, creates 20,000 synthetic products, compares seven EXPLAIN ANALYZE runs before/after the name index, and rolls back both fixture data and temporary DDL. It never targets the configured Supabase project.

Observed local median database execution for one selective name substring: **12.547 ms before / 1.245 ms after**. The query changed from sequential scan to an indexed plan. This is a narrow warm-cache diagnostic, not a production latency or Core Web Vitals claim. Network latency, database region/tier, concurrent traffic, data distribution and device performance still matter.

## Canonical routes

| Previous URL | Canonical URL |
| --- | --- |
| `/dashboard/produk` | `/dashboard/master-data/products` |
| `/dashboard/inspeksi` | `/dashboard/quality/inspections` |
| `/dashboard/coa` | `/dashboard/quality/certificates` |
| `/dashboard/pengguna` | `/dashboard/admin/users` |
| `/dashboard/audit` | `/dashboard/admin/audit-log` |
| `/dashboard/settings` | `/dashboard/admin/settings` |
| `/dashboard/materials` | `/dashboard/warehouse/materials` |
| `/dashboard/documents` | `/dashboard/product-documents` |
| `/dashboard/work` | `/dashboard/workspaces` |
| `/dashboard/arsip` | `/dashboard/product-documents` |

Permanent 308 redirects retain query parameters. Navigation, search results, action revalidation and new database-generated links use canonical paths. Internal database names and legacy export module identifiers remain stable to preserve API compatibility and existing records.

The Quality archive UI, navigation entry, summary card and analytics tab are retired. Product Documents is the current document workspace; legacy archive rows are retained, **not** automatically converted into controlled product revisions.

Each workspace has descriptive server-owned title/description metadata. The internal ERP is `noindex, nofollow`; no private content is promoted through public search/social metadata. Favicon, PNG icon and Apple icon derive from the original INBIONUSA logo and are publicly accessible without a session. The existing logo is unchanged.

## Validation

Database regression includes migration repeatability, exact analytics/summary comparisons, session expiry/deactivation, forced-password handling, module-denied access, literal wildcard search and private RPC grants. Browser regression checks canonical navigation, 308 query preservation, per-page titles, noindex metadata, public icons and the existing QC/ERP workflows, including mobile and dark mode.
