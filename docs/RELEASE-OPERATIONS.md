# Operations release: lot identity and daily workspace

This release implements the decisions recorded in OPERATIONS-DESIGN-DECISIONS.md. Finance, accounting, purchasing, packaging labels, maintenance, BOMs and raw-material consumption are outside this release.

## Deploy safely

Apply migrations 001–004 first, then **005_release_operations.sql**, before deploying this application revision. Back up and review the live database first. The application does not run migrations automatically. Local integration tests reset only a disposable PostgreSQL instance; never point them at production.

Migration 005 is transactional and repeatable. It retains existing lot identities and documents, adds unique product series and yearly batch counters, adds return/assignment tables, and replaces the session-authorized ERP/QC wrappers. New tables have RLS and no direct access for anon/authenticated/service_role; operations run through authorized RPCs. Do not reapply an older migration by itself after a newer wrapper migration.

Real product names matching a single word followed by a unique numeric series can receive an initial series mapping. Unmatched or ambiguous seed names require explicit setup. No stock or users are invented.

## Product series and production

Open Master data → Product series and set a unique numeric text series, e.g. `01` or `200`. Leading zeros are retained. A series cannot change after the first generated production batch.

Production drafts have temporary DRAFT identities and consume no official number. Each line represents one batch. Posting allocates an atomic per-product/per-manufacturing-year sequence and assigns:

`Series.Batch.DDMMYYYY.ExpiryYear`

For INDOSTER 01 on 18 October 2026, the first batch is `01.01.18102026.2027`. Minimum batch width is two digits; 99 continues to 100. Backdated production uses the manufacturing year. Posting twice has no additional effect; reversal never reuses an official number. Existing matching historical lot numbers are skipped rather than renamed. Posted production identities and dates are locked.

## Inspection and mobile entry

With Production active or read-only, new inspections select an existing physically received/produced lot. Product and lot are populated from that selection; dates cannot precede manufacturing. The server rejects invented manual identities. Existing historical inspections can retain their original identity when edited. Standalone manual QC remains available only when Production is disabled.

Follow Create inspection from a lot or inbox item to open that lot directly. On mobile the editor fills the viewport, retains the footer, uses larger inputs and parameter cards, and shows result completion progress. Enter/Next advances between result inputs. Existing draft, failure explanation, specification and certification protections remain in force.

## Navigation and analytics

Desktop uses collapsible grouped sidebar navigation. Mobile uses Home / Work / Search, without a duplicated global top navbar. The account button appears on Home. Work lists authorized groups and their destinations; forms hide bottom navigation. Quality analytics remains available at `/dashboard/quality`.

Home shows needs-attention work, one manually selected performance context, and recent actions. Context and period are remembered locally. Graphs use counts of records (not sums of incomparable stock units), and labels distinguish open/draft/held counts from period metrics. Overview's activity graph is the signed-in actor's recorded actions; operational metrics are gated by accessible modules. There is no automatic carousel or claim that quotation/order values are revenue.

## Traceability and hold

Warehouse → Lots & traceability shows lot identity, location balances, reservations, current inspection/COA reference, and paginated movement history. Delivery events show the frozen customer name only to users with Sales read access. Historical shipping snapshots are retained.

Warehouse approvers can hold a lot with a reason. A held lot remains quarantined even if a subsequent inspection passes; reservations and shipment are blocked. Hold removal restores the valid QC status rather than fabricating a PASS. Received returns use the separate disposition action instead of generic hold removal.

## Physical customer returns

Warehouse → Returns → Request return selects a posted delivery, shipped lot, return location, base-unit quantity and reason. Requested/received returns cannot exceed that delivery's shipped quantity. Cancel an unreceived request if it was entered incorrectly.

Receive into quarantine creates and posts a receipt exactly once into a separate held return lot linked to the original lot. Its number appends the return document reference to the source lot number. The original production lot and delivered order quantity remain unchanged. A return is a new physical event, not a reversal, refund or credit note.

After receipt, record a fresh inspection on the return lot. A Warehouse approver can release it only after a current valid PASS and before expiry, or approve disposal with a reason. Disposal posts an issue through the immutable ledger; count freezes and stock checks still apply. An original delivery with uncancelled return history cannot be reversed.

## Work inbox

The inbox derives tasks from actual open work: uninspected quarantined lots, quotation approval/expiry, orders awaiting delivery, stock-count approval and return review. It respects module modes and read permissions. Approvers can assign an active eligible user and optional due date. Task completion follows the underlying transaction; there is no independent checkbox that falsely completes an inspection or shipment. Assignments persist while that task is open. This is an internal inbox; no email, WhatsApp or push notification integration is included.

Stock-minimum alerts still require a future threshold policy; they are not fabricated. Traceability starts at finished goods and does not claim raw-material genealogy.
