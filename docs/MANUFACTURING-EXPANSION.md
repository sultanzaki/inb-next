# Manufacturing, material quality and logistics

## Delivered scope

- **Production:** versioned formulas/BOM (ingredients and packaging, each in its base stock unit), approval/supersession, scaled manufacturing orders, material reservations, actual weighed consumption, unused material returns, finished output, official batch numbering, yield/scrap reconciliation, deviation gates, closure, and material → production → finished batch → customer delivery genealogy.
- **Material Quality:** explicit QC/supplier policies per material, revisioned specifications, supplier qualification with validity, incoming inspection drafts and server-evaluated results, quarantine/release/rejection, controlled retests, holds/disposal, investigation/disposition, CAPA evidence and effectiveness review.
- **Multiwarehouse:** stable warehouse/location identities, rack/bin metadata, per-user warehouse scopes, loose and pallet transfers, source dispatch → stock in transit → actual/partial receipt, approved shortages, and history. No destination stock is invented at dispatch.
- **Pallets:** unique identity, mixed lot contents, packing/unpacking, partial repacking/merging into another pallet at the same location, whole-pallet moves, interwarehouse manifests, partial delivery picking, retirement, QR labels and history. Packing alone never creates or consumes stock.
- **CRM:** sample request/approval, stock preparation/reservation, courier/reference capture, actual shipment, customer feedback and one linked quotation; customer interactions and assigned follow-ups; version-specific product-document distribution and receipt acknowledgment. Distribution records what staff sent; it does not send email or messages.
- **Service:** a resolution checklist uses existing actual physical execution, approved settlement and verified financial records. A draft request is not treated as completed execution.
- **Documents:** server-generated A4 batch sheet, material requirement/usage sheet, incoming inspection report and transfer reconciliation document; printable QR pallet label. Existing COA/commercial PDFs retain their established layouts.
- **Workspaces:** contextual searchable reference pickers, draft/edit validation, deliberate slide confirmations, replay-safe submissions, record skeletons, download loading, exact numeric transport, advanced tables with filters/sorting/visibility/saved views/pagination/filtered CSV and Excel, mobile layouts, light/dark themes, and individual page titles.

Routing and machine timings, MRP/forecast, costing/accounting, and external communication integrations remain excluded. Existing Finance and service controls remain in force for sales deliveries.

## Deployment

The expansion is additive to an environment already running migrations **001–017**. Apply these committed files **in order**, with stop-on-error enabled, before deploying the application:

1. `018_manufacturing_foundation.sql`
2. `019_material_quality.sql`
3. `020_manufacturing_execution.sql`
4. `021_warehouse_pallets.sql`
5. `022_customer_operations.sql`
6. `023_operations_gateway.sql`
7. `024_warehouse_scope_integrity.sql`
8. `025_operations_completion.sql`
9. `026_operational_documents.sql`
10. `027_operational_access.sql`

Location: `src/lib/db/migrations/`. Each migration owns its transaction. All ten are tested in sequence and applied a second time to verify repeatability. Stop if a migration fails; do not skip the failed file. Take the normal database backup before deployment. No migration has been applied to production by this change.

For a local SQL client, this command generates a single reviewable SQL bundle from the committed sources:

```bash
cat src/lib/db/migrations/0{18,19,20,21,22,23,24,25,26,27}_*.sql > /tmp/inbionusa-manufacturing.sql
```

Run that file in the target SQL environment only after reviewing it and confirming the target project. It contains multiple transactions, so earlier successful files remain applied if a later file fails. Fix the cause and rerun the complete ordered bundle; the migrations are repeatable. It preserves users, existing records, immutable stock ledgers and location IDs.

The new font/logo asset tracing rule in `next.config.ts` is required for server PDFs on hosted deployments. No PDF generation depends on external font downloads.

Existing module activation states are retained. New pages belong to existing Production, Quality, Warehouse, CRM, Service and Documents modules. Migration does not enable a disabled module.

## Transition from the existing production register

1. Confirm each finished product has a base stock unit and unique product series.
2. Confirm material base units, suppliers and warehouse locations.
3. Create and approve a formula/BOM. A formula defines quantities for a reference output; orders scale that reference to their planned output.
4. Products with an approved formula must post output through a manufacturing order. The old production register remains readable; manual production is retained for products without an approved formula.
5. Historical material consumption is **not reconstructed**. Old production records without real input links cannot acquire a fabricated batch sheet or genealogy.

### Material Quality rollout

Existing material stock is explicitly marked `legacy`, not backfilled with PASS. New supplier lots start `quarantine`, but inspection and supplier qualification enforcement are **opt-in per material** to preserve the existing small-company workflow.

Prepare specifications/qualifications first, then enable **Require incoming Quality release** and/or **Require an approved supplier** from Quality → Material release policies. Enabling QC makes unassessed material unavailable until an effective inspection is finalized. A rejected/disposed lot stays unavailable even if the policy is subsequently disabled. Holds, expiry and supplier status also affect eligibility.

A finalized inspection is immutable. Further testing uses **Retest** with an approved deviation for the same lot/inspection. Starting another ordinary inspection cannot bypass this rule. Passing a retest does not silently remove a separately imposed hold. For a retrospective supplier issue, review genealogy and use the existing hold/recall/service workflows; historical shipments are not rewritten.

## Operator guide

### One production batch

1. **Production → Formulas & BOM:** enter product/base unit, reference batch size and material/packaging quantities. Approve the formula.
2. **Production → Production orders:** choose the approved formula, planned quantity/date and finished-goods location. Review the scaled requirements and release the order.
3. **Reserve material:** select an eligible supplier lot and its actual source location. Reservations reduce available stock; on-hand quantity remains unchanged.
4. **Consume material:** enter the actual weighed quantity against the reservation. This is when raw-material warehouse stock decreases. Repeating the same submitted request cannot deduct it twice.
5. **Return unused material:** select the original consumption record and actual unused quantity. The return cannot exceed the quantity originally consumed minus previous returns.
6. **Record output:** enter actual finished quantity and manufacturing date. Posting creates the official finished batch and one-year expiry under the established product-series rules. Finished stock starts in QC quarantine.
7. Release unused reservations. Reconcile actual inputs, finished output and scrap. Material usage outside formula tolerance, excess output or unreconciled yield requires an approved production deviation.
8. **Close production order:** after reconciliation and resolution of open production deviations. Outbound shipment/sample issue remains blocked until this closure, even if Quality testing has already passed. The batch sheet is frozen in the closing transaction with material/operator/product names and actual quantities.
9. Download **Batch sheet PDF** or **Material usage PDF** from the order detail. Earlier states are visibly DRAFT/work in progress. Closed records are immutable. A final batch sheet does not replace Quality release or authorize shipment.

### Moving stock between warehouses

1. Create a transfer, choose source/destination and loose lots and/or packed pallets.
2. Dispatch from the source. Quantities leave source stock and remain in transit; pallets cannot be edited while in transit.
3. The destination records actual receipt. Loose quantities can arrive in several receipts. A pallet receipt must account for every outstanding manifest line together; approved shortages are recorded explicitly.
4. Remaining loose shortages can be closed with warehouse approval and a reason. No stock is created for missing quantities. Download the transfer PDF to see dispatched, received, missing and outstanding quantities separately.

### Pallets

Create a pallet at a storage location, then pack already-existing stock. Repack a selected quantity into another current pallet at the **same location** to split or merge container contents. Whole-pallet location moves use the stock ledger; moves across warehouse boundaries use an in-transit transfer. Delivery picking removes selected pallet contents and posts the linked delivery atomically, preserving payment/COA gates. Unpack before a generic loose-stock operation. QR labels open the authenticated current pallet record; printed contents are a dated operational snapshot, not permanent proof of current contents.

### Customer samples and documents

Create a sample request for a customer/product/unit, approve it, then prepare from released unexpired stock. Preparation reserves stock. Shipment posts the actual stock issue and records the courier/reference. Capture customer feedback and create the linked commercial quotation. Shipped samples cannot be silently cancelled; use a service case for a physical return or other resolution.

Log interactions with an owner and optional follow-up date. Complete a follow-up with its outcome. For product documents, record the recipient/channel/evidence for a current published revision and then its acknowledgment. The sent document snapshot remains revision-specific when the master document changes.

## Access and integrity

- Administrator accounts retain full access. Other accounts still need module permissions. Warehouse scopes narrow that access; they never grant a module permission.
- **Read**, **Operate** and **Approve** can be assigned per warehouse. Source operators can dispatch to an active destination without receiving permission to inspect its inventory; destination operators can receive the manifest.
- Production operators performing physical material consumption/return/output need the corresponding Warehouse operating access. Approval permissions are checked separately from draft-edit permission. Configure cross-module overrides where one employee performs several functions.
- Batch PDFs require access to every material source warehouse, preventing a complete frozen document from disclosing hidden source details.
- Global stock mutations use the existing transaction lock. Final-state/version checks, request identifiers, immutable ledgers and stock guards protect against duplicate clicks, competing updates, negative stock, count freezes and bypassing reservations/pallet allocations.
- Controlled production, transfer, pallet, sample and disposition transactions cannot be reversed through a generic operation that would leave their parent workflow inconsistent.
- New tables and private helpers are not directly callable by anon/authenticated/service-role REST clients. Authorized RPCs enforce session, active account, module, role and warehouse access.
- Operational downloads/exports are private/no-store and logged. Ordinary reads overlap independent database authorization with the application session check; no response is released before authorization succeeds.
- List requests skip nested transaction/history payloads. Details load those payloads on demand. Relation indexes support batch, inspection, transfer and pallet lookups.

## Verification

Automated checks include domain/number/PDF tests, the existing database regression suite plus manufacturing/logistics regressions, production build/type/lint checks and authenticated browser workflows on desktop/mobile. Test services use only disposable loopback PostgreSQL/PostgREST, never production. Validation completed: 44 unit/domain/PDF tests; 135 database regression tests, including 13 manufacturing/logistics/access/concurrency scenarios; authenticated full browser regression; focused desktop/mobile operations checks; HTTP access checks; lint, TypeScript and production build. The final browser pass also checks filtered CSV/Excel, anonymous API rejection and dark mode.

```bash
npm test
npm run test:db
npm run lint
npm run typecheck
npm run build
TEST_OPERATIONS_ONLY=1 npm run test:e2e
```

The browser test creates real local records, fills a mobile inspection form, downloads a server PDF, verifies QR output/origin protection, visits the new routes and checks overflow/accessibility. Database tests cover actual material use/returns, frozen documents, QC/retest/CAPA, scopes, stock in transit/shortages, partial repacking, samples/quotations, revision-specific documents, replay/concurrency and direct-access rejection.
