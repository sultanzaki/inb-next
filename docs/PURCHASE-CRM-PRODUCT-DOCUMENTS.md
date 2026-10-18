# Purchase, raw materials, CRM and product documents

## Deployment

Apply `src/lib/db/migrations/006_purchase_crm_documents.sql` in Supabase **after migration 005**, then deploy the matching application. This is a forward migration and runs in a transaction. It preserves existing finished-goods stock, production identities, customers, quotes and QC records. Reapplying 006 is supported; do not rerun older migrations over a newer database.

The migration has been exercised against the disposable local PostgreSQL/PostgREST environment. Applying it there does not migrate the live Supabase project. No new secret or storage bucket is required for this release.

Purchase, CRM and Documents initially become active. Administrators can change their module mode and grant read, write and approval access from Settings. Other users receive no new module access automatically. Direct tables and internal/historical RPC wrappers remain inaccessible to browser roles and service-role REST reads. Mutations run through session-authorized RPCs and produce audit records.

Do not manually delete the new tables to roll back a release once transactions exist. Use module read-only mode to pause work while preserving its history.

## Purchase

1. Create a supplier with contact information, address, tax ID and payment terms.
2. Create raw materials with a unique code, a manually configured base unit and a minimum stock level. Materials are separate from finished products and never generate finished-product batch numbers.
3. Create a purchase order with supplier, currency, order/expected dates, terms and up to 100 material lines. Every line uses the material's base unit. Save and edit the draft without changing stock.
4. An approver confirms the order. Confirmed orders retain the supplier identity and material descriptions captured at confirmation/draft creation, respectively. Preview/download the server-generated purchase order PDF from its detail view.
5. Receive all or part of the order. Enter the actual received quantity, supplier lot number, optional expiry date, destination and delivery reference. Blank quantities skip a line. Repeat partial receipts until the order is received in full.

Receiving needs both Purchase write and Warehouse write access. Confirmation and cancellation of a confirmed order require Purchase approval. A partially received order may have its remaining balance cancelled with a reason; received stock is retained. Open orders prevent disabling Purchase, and open confirmed/partial orders prevent disabling Warehouse. Read-only mode remains available.

Receipt posting checks the current order version, outstanding quantities and supplier-lot expiry metadata again inside one database transaction. It rejects expired-at-receipt lots, future receipts, receipts dated before the PO, over-receipts and stale edits. Request keys prevent duplicate stock posting on replay. Amounts and quantities stay PostgreSQL decimal strings, including in the PDF and CSV.

## Raw material stock

Warehouse navigation contains **Material stock** and **Material ledger**. Stock is tracked separately for each material, supplier lot and location. Lot rows show expiry and a 30-day expiry warning. Raw material master records flag usable stock below the configured minimum; expired lots remain in physical stock but do not satisfy that threshold.

Use **Issue material** to record manual consumption with a date and production/reference reason. The chosen lot/location supplies the material identity; the server rejects insufficient or expired stock. This records material consumption only: it does not create a BOM, manufacturing order or automatically deduct materials when recording finished production.

Ledger details allow **Reverse transaction** with a reason. Warehouse approval is required; reversing a receipt additionally requires Purchase approval. Reversal creates immutable counter-entries, restores outstanding purchase quantities and cannot make stock negative. If received stock has been consumed, restore that stock before reversing its receipt. Repeated reversal requests do not create duplicate entries. Cancelling an order and reversing a receipt are separate operations.

## CRM

Create opportunities with company/contact, source, owner, expected value/currency, probability, expected close and notes. Owners are selected from active CRM writers. Filter the pipeline by Lead, Qualified, Proposal, Won or Lost. Stage changes require a reason; Won requires a linked customer. Closed opportunities can be reopened through a reasoned stage change.

Schedule calls, emails, meetings or tasks with an assignee and due date. The Activities list supports open, overdue, completed and cancelled filters; complete an open activity from its details. Opportunity details retain its follow-up history. Due activities also appear in the shared work inbox.

**Link customer** can select an existing Sales customer to avoid duplicates or create a new one from the prospect's company/contact. It requires Sales write access and is replay-safe. From a linked opportunity, **Create quotation** opens a Sales draft with the customer and CRM source prefilled. Changing that customer clears the source link. The database checks the customer/source relationship; links survive quotation edits and revisions, and quotations appear in the opportunity's history.

Expected deal values are kept in their own currencies. The dashboard uses counts rather than combining unlike currencies into a misleading pipeline total.

## Product documents

Documents supports SDS, TDS, Halal, ISO and Other document types in English or Indonesian. Each record references a finished product, HTTPS file link, effective date, optional expiry date and notes. Files remain with the existing document provider; its sharing/access rules apply. Use version-specific file links to preserve the source file for each revision. This release manages references and revision metadata; it does not upload files to Supabase Storage.

1. Create and review a draft. Its revision is numbered automatically within the product/type/language series.
2. An approver publishes a currently effective, non-expired draft. The previous published revision in that series becomes superseded atomically.
3. To replace a published document, use **New revision**. Published metadata cannot be edited through the application. Review the copied dates and link before publishing.
4. Withdraw a draft/current document with an approval and reason when it must no longer be used. History remains accessible.

The status is calculated as Draft, Valid, Expiring (within 30 days), Expired, Superseded or Withdrawn. Expired published revisions remain visible with a warning, and expiring/expired documents appear in the work inbox. Expiry is evaluated on read using the Jakarta business date; it needs no scheduled job.

The product detail view links to documents scoped to that product. Creating a document from that list prefills its product. The product scope is enforced by the server and retained in filtered CSV exports.

## Shared behavior and boundaries

All lists use server pagination, text search, status filters, filtered CSV export and the existing mobile navigation/dialog conventions. Global search includes suppliers, materials, purchase orders, opportunities and product documents. Dashboard context selectors include Purchase, CRM and Documents. Permissions and module modes are checked by the server, including for export, PDF and search.

This release does not add accounting, supplier invoices/payments, foreign-exchange conversion, automatic material planning, BOMs, material unit conversions, incoming-material inspection workflows, or external email/notification delivery. Those are separate workflows rather than hidden side effects of purchasing.

## Verification

`npm run test:db` now includes growth transaction tests after the original QC/ERP migrations. They cover repeatable migration, partial/exact receipts, duplicate/concurrent posting, rollback, supplier snapshots, unit locking, cancellation, stock issues/reversals, access/module modes, CRM conversion/quotation linkage, activities, document versions/expiry and product scoping.

`npm run test:e2e` includes the new browser workflows alongside the existing suite. For focused iteration after database setup and a production build, run `TEST_GROWTH_ONLY=1 npm run test:e2e`. Browser checks cover actual forms, PO PDF, receiving/stock, CRM-to-Sales handoff, publication, CSV, dashboard contexts, accessibility and mobile overflow at 320/375/430px. All database integration commands target the disposable loopback database, never production.
