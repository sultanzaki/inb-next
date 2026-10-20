# Phase 4: transaction controls

Apply `015_transaction_controls.sql` after migration 014, before deploying this code. Existing business records and user accounts are retained. No automatic financial tolerance or tiered approval policy is introduced.

## Close remaining quantities

Sales and Purchasing approvers can review and close an unfinished confirmed order. The preview shows ordered, completed and remaining quantities, reservations and linked financial exposure. A reason and a current preview are required; changed source records require a fresh review. Existing maker/checker rules apply.

Original quantities and totals remain unchanged. Sales reservations are released, future deliveries/receipts stop, and actual deliveries/receipts remain billable. Closing does not settle invoices, refund funds or remove stock. Resolve draft deliveries, draft billing, excessive advance requests and overbilling first. Closure is immutable; use approved claims/returns for subsequent corrections.

## Purchase matching

Supplier bills show ordered, received, previously billed and current quantities, plus agreed and billed prices. Quantities cannot exceed available actual receipts. A price difference requires a Finance approver to acknowledge supporting evidence and record a reason of at least 10 characters. A source change invalidates a draft bill review. Issuance remains a separate approval. No difference is silently written off.

## Corrections and history

Document details show correction guidance and paginated change history with actor, time, action, reason and before/after values. History starts when migration 015 is installed; existing amendments are displayed separately and earlier activity remains in the audit log. Direct database changes are identified as database administration. New event and closure records are immutable and unavailable through direct public table access.

Issued advance requests may be cancelled by Finance approvers after all active allocations are reversed or moved. Verified payments remain recorded and available for reallocation; cancellation does not perform a refund. Issued invoices use linked credit notes; posted stock uses authorized reversals where allowed, otherwise claims/returns.

## Validation

Database tests cover stale reviews, permissions, partial closure, reservation release, retained stock and original quantities, billing after closure, advance cancellation without deleting funds, explicit variance review, prevention of excess receipts/billing, immutable history, private RPC helpers and repeatable migration. Browser coverage exercises closure review and history on mobile with overflow and accessibility checks.
