# Operational exceptions and Finance

## Rollout

Apply migrations **010 → 011 → 012 → 013**, after the existing 001–009 migrations, before deploying this revision. Each migration is transactional. Do not apply an older wrapper migration in isolation after a newer one. The application does not execute SQL migrations automatically.

If 012 reports that `public.erp_quote_order(text, uuid)` is missing, apply `009_quotation_order_link.sql` first, rerun 012, then apply 013. Migration 009 only adds the authorized quotation/order lookup; it does not change business records. Do not delete data or replay migrations 010/011 for this error. The new preflight reports the missing dependency before replacing wrappers or revoking permissions.

Both new modules start **disabled**. Existing accounts, stock and documents are retained. An administrator activates **Service** and **Finance** in Administration → Module settings and assigns the relevant roles or explicit module grants. Activate Service before using receipt-based invoicing, linked claims or controlled amendments. Finance can otherwise operate independently.

Prepare approved terms for each open SO, credit policies for credit customers, and actual outstanding invoices/advances before activating Finance in production. Once active, a draft delivery cannot be posted without financial clearance. Read-only Finance retains this gate. Finance with transaction history cannot be disabled; use read-only instead. An administrator can approve their own entry with a reason; other users require a different authorized approver. A dispatch exception lasts at most seven days and does not settle debt.

Back up the live database and rehearse the migrations and these business flows on staging. Local tests use a disposable loopback PostgreSQL/PostgREST instance. A local passing test does not mean the live Supabase project has been migrated.

## What is covered

| Phase | Coverage |
| --- | --- |
| Transaction integrity | Existing global transaction lock, stock reservations, atomic posting, immutable ledgers and document numbering retained. New create/execute actions accept request identifiers; replay returns the original result and changed payload reuse fails. Version checks protect reviewed terms, cases and billing documents. |
| Partial fulfillment | Existing partial receiving, reservation, partial deliveries, order remainder closure, PO cancellation and stock-count freeze remain in place. Approved quantity amendments add before/after history and cannot reduce below delivered/received quantity. Prices and product identity remain unchanged. |
| Receiving and quality exceptions | Supplier/receiving cases, raw material hold and issue blocking, linked supplier returns, quality retests, retained historical inspections, certificate withdrawal and replacement COA issuance. |
| Delivery and customer claims | POD with recipient, line-level acceptance/rejection and evidence; approval queue, assignee, due date, quantity cap, cost responsibility, replacement shipment, customer return request and physical receipt tracking. |
| Finance A | Approved SO terms: prepaid, deposit with balance before dispatch, deposit plus credit, or credit. Per-currency customer limit, manual credit hold, overdue hold, exposure check and dated dispatch override. |
| Finance B | Advance requests, quantity-derived partial invoices, order/dispatch/customer-receipt billing triggers, verified receipts, exact decimal allocation, overdue status, AR/AP aging, follow-up, payment promises and disputes. |
| Finance C | Supplier advances and bills, PO/received/unbilled quantity matching, supplier invoice reference uniqueness, explicit price variance, payment verification and approval. |
| Finance D | Linked credit notes, supplier credits, refunds, credit application, allocation reversal and partial/full allocation movement. Claim settlement requires the approved amount and matching source. |
| Daily work | Permission-filtered inbox, pending approvals, overdue invoices/bills, broken payment promises, payment verification tasks, linked case timeline, cross-module search, filtered CSV and server-generated billing PDFs. |

## Sales and collection

1. Accept a quotation and create its single SO as before.
2. Finance → Dispatch clearance → SO → Configure payment terms. A Finance approver reviews them. A change to terms requires approval again.
3. For prepaid/DP, create and issue a **payment request** from the SO. Record the actual bank receipt; an approver verifies funds. Allocate the verified payment to the request. The request is an advance request, not a tax invoice.
4. For credit/deposit-credit, approve the customer's currency-specific credit limit. Overdue invoices and manual holds block dispatch unless an explicit dispatch exception is approved.
5. Warehouse posts delivery after the same financial check runs inside the stock transaction. No browser-only override exists.
6. If billing is triggered by customer receipt, record the POD in Service → Customer receipts first. Partial/rejected quantities are retained as evidence; a claim determines the commercial correction.
7. Create an invoice for the specific order/delivery quantities. Agreed net price, tax and freight come from the SO. Draft invoices reserve unbilled quantities; void an unwanted draft to free them.
8. Move the advance allocation to the final invoice, all at once or partially. Never record a second bank receipt for the same funds. Allocate later verified receipts as they arrive.
9. For overdue accounts, record follow-up/promise/dispute. Promises do not move the contractual due date; disputes do not remove debt. Set a credit hold when required.

## Purchasing and payments

Confirm a PO and receive goods as before. Finance → Purchase matching shows ordered/received/unbilled quantities. Before receiving, use a supplier advance request. After receiving, draft the supplier bill against received quantities, enter the supplier invoice reference, review price variances, then issue it with an approval reason. Record and verify an actual outgoing payment before allocating it. This software records payments; it does not instruct a bank to transfer money.

## Claims and corrections

Create a case from the original delivery, material receipt, lot, product, PO, SO or product document. Choose the matching case type, record evidence, assign an owner and submit for approval. Approval decides resolution, cost responsibility and estimated costs. Credit/refund decisions also require an approved settlement amount, separate from freight or handling cost.

An approved replacement consumes eligible released stock through a linked issue. It does not increment the original SO's delivered quantity again. A customer return creates a Warehouse return request; receive the goods there into quarantine and perform disposition as before. The case cannot resolve before its approved physical quantity has actually been processed. Supplier returns consume stock from a lot belonging to the original receipt, including held lots, and remain capped by received/approved quantities.

For a financial resolution, create a linked credit against the original invoice/bill. Applying credit and actually refunding money are separate actions. Verified refund allocations or applied credits must reach the approved settlement amount before the case can resolve. Reversing linked stock execution or a refund allocation reopens its case for review and records the reason; an old completion reference cannot settle a reversed payment. When Finance is disabled, a Service approver can instead record an external settlement reference.

SO/PO amendments require an approved change-request case with correction resolution. Keep the same lines and agreed prices; revise quantities and, for a PO, expected date/terms. Resolve draft deliveries and billing first. Existing dispatch reservations are released for deliberate re-planning; SO financial terms become pending again. Billed changes require the credit/return flow, rather than silently rewriting invoiced history. Close an SO remainder or cancel an open PO for an entire cancellation.

For a quality retest, approve a lot case, withdraw the previous certificate if applicable, then start the linked retest. Record a fresh inspection through Quality. The old inspection and signed COA snapshot remain in history; withdrawn certificates cannot be downloaded as valid certificates. The hold stays in place until an authorized disposition. No expiry date extension is implied by retesting.

## Boundaries

This is operational AR/AP, not general-ledger accounting: no journal posting, payroll, statutory tax invoice submission, bank integration, FX conversion or revenue recognition. Aging and limits are separated by currency. Cost responsibility records the decision and actual cost; it does not create an accounting journal.

Reminders are in-app work items, not automatic email/SMS or scheduled customer collection messages. There are no interest calculations, automatic legal escalation or bad-debt write-offs. Document-issue cases track document problems; existing controlled document revisions remain the publishing mechanism. Manufacturing stays at finished-production recording; BOM/MRP, rework and batch splitting/merging remain outside this release.

## Verification

Run `npm test`, `npm run test:db`, `npm run test:http`, `npm run lint`, `npm run build` and `npm run test:e2e` with the documented disposable services. `TEST_FINANCE_ONLY=1 npm run test:e2e` repeats the new desktop/mobile flows on their own. The database suite applies each new migration twice and exercises authorization, concurrent-review versions, idempotency, invoice caps, actual stock returns, retests, credit/refund corrections, dispatch gates and broken promises. Browser checks cover real forms, PDF/CSV responses, accessibility and mobile overflow. Never run the database reset suite against live data.
