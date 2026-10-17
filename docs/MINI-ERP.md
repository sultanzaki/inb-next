# INBIONUSA modular operations

This release connects finished-goods Production, Warehouse, Sales and the existing Quality workflow. Finance, purchasing, BOMs and raw-material consumption remain outside this release.

## Deployment order

1. Review and back up the existing database. Existing installations must already have migrations 001–003.
2. Run `src/lib/db/migrations/004_modular_erp.sql` in the Supabase SQL editor **before deploying this branch**. The file is transactional and repeatable. Use the migration file, not the destructive test setup.
3. Deploy the application. Sign in as an existing `admin qc` or `administrator inbionusa` account.
4. Open Administration → Settings. Configure units, product conversions and locations, then grant staff module access.

The migration creates no users and invents no stock balances. Existing QC lot identities and available certificate dates are linked without creating opening stock. Record actual opening quantities through a documented receipt or an approved physical count. The initial location is `MAIN / Main storage` in one `Main warehouse`.

All four modules initially activate, matching the agreed scope. Existing QC roles retain their legacy defaults. Administrators retain all module permissions. For an operational-only user, create the account through Users, grant the required Warehouse/Production/Sales rights, and explicitly set Quality Read/Write/Approve to false if that user should not see QC data. Quality writes also require an existing QC write role. Module grants never bypass QC's validated evaluator or certified-result protections.

## Navigation and access

Desktop uses a topbar module selector and contextual destinations. Mobile uses the workspace launcher. Products remain shared master data. Settings, Users and Audit are administration destinations.

Each module has `active`, `read_only` and `disabled` modes. Read-only permits historical reads and PDFs while blocking writes. Disabled blocks module APIs and operational pages; retained history becomes available again when enabled. Permissions and module state are checked inside database RPCs on every operation, independently of menu visibility.

Warehouse cannot be disabled while Production is active or movements/counts/reservations remain open. Production drafts must be resolved before disabling Production. Sales must resolve open quotations/orders before disabling. Quality must resolve inspection drafts. Read-only is the pause option when work is still open.

Warehouse posting, reservations, QC release and module configuration share a transaction lock. This deliberately favors correctness for one warehouse. Quantities use PostgreSQL fixed decimals; ledgers and reservations change atomically. Double posting never adds stock twice. Posted ledger rows cannot be updated or deleted by application roles.

## Units and product setup

Units are manually maintained; initial examples are kg, t, bag, drum and unit. There is no global assumption that a bag or drum has a particular weight. Set one base stock unit per product and add product-specific conversions, for example one bag = 25 kg.

The base unit is locked after transactions reference the product. Saved movement/quotation lines retain their conversion factors. Later conversion changes affect newly saved lines. Quantity inputs accept a decimal dot or comma, with at most six decimals and no thousands separators. Server-calculated stock quantities use six decimal places; commercial line amounts use two. Large decimal strings are formatted without converting balances through floating-point calculations.

## Finished production and warehouse

1. Record a production draft with product, unit, quantity, lot, manufacturing date, destination and reference.
2. Review the draft, then Post. Drafts do not change quantities.
3. Newly received lots start in quarantine. Existing released batches retain their recorded QC identity.
4. A validated, current PASS inspection releases the matching lot; future-dated PASS inspections remain quarantined and FAIL blocks it. QC evaluation never changes physical stock.
5. With Quality disabled, Warehouse approvers may release a lot manually with a reason. This does not create a PASS inspection or a COA. Re-enabling Quality puts manually released lots without a current valid PASS inspection back into quarantine.

Warehouse supports receipts, internal issues/samples/damage, location transfers, a stock register, a movement register and an immutable stock ledger. On hand, reserved and available-to-sell are separate values. Quarantined, rejected, undated-expiry and expired lots are unavailable for sale. Physical issues/transfers cannot consume reserved stock. Negative stock is blocked at posting.

Use a reasoned reversal to correct a posted operation. A reversal records opposite ledger entries, retains the original record and marks it reversed. It fails if the current balance/reservations prevent the correction. Reversing a delivery updates the order's delivered quantity and reopens its outstanding quantity; consumed reservations remain in history, and any new allocation is explicit.

## Stock counts

Plan a count for a location, optionally assign a counter before starting, then Start to snapshot quantities and freeze that location. Receipts, issues, transfers and shipments affecting it are blocked while counting/submitted.

Count sheets paginate and support product/lot search and counted/not-counted filters. Blind counts hide baseline quantities on the count sheet from counters; approvers can review them. Existing broader Warehouse permissions still control access to the stock register. Enter every quantity, including explicit zero. Unlisted lots can be added; new lots remain quarantined.

Submit freezes entry. Warehouse Approve permission and a reason are required to post variances. The system creates an adjustment movement and ledger entries, rather than overwriting stock history. Adjustments cannot reduce balances below reservations. Cancellation before posting releases the location freeze and retains the count record.

## Quotation and sales order

Customers contain billing/shipping addresses, contacts, tax reference and payment terms. Quotations support multiple items, units, quantities, unit prices, discounts, currency, tax rate, freight, validity, lead time and terms. These are quotation amounts; this release does not create accounting entries or tax invoices.

Save a draft, preview the server-generated PDF, then issue it. Discounts above 10% enter Pending approval. A Sales approver provides a reason to approve, or returns the draft for changes. Issued content is frozen. Customer/master edits do not rewrite the issued PDF. Revisions create separate draft records; issuing a revision supersedes the previous issued revision. Accepted quotation families cannot be revised or converted twice.

Record acceptance, then create a Sales Order with an optional customer reference. Quantities are converted into the saved base-unit quantities for fulfillment. Reserve released, unexpired stock; the picker suggests earliest expiry first. Reservations require Sales Write and Warehouse Read, with Warehouse active. Concurrent reservations cannot oversell the same balance.

Create delivery drafts from active reservations, one source location per delivery. Partial deliveries are supported. Warehouse Write may prepare/post deliveries while Sales is active. Posting rechecks lot status, expiry, order state and reservation quantities. If Quality is enabled, a COA with matching lot/manufacturing/expiry information is required and captured with the shipment. Download the delivery PDF and the attached COAs from the movement detail.

Delivery snapshots preserve the customer/logistics data and COA content at posting. Later edits to the original certificate do not rewrite an old shipment's attached COA. Fulfilled orders complete automatically; closing outstanding orders requires a reason and releases remaining reservations.

## Reports, PDFs and limits

- Operational lists and lookup pickers paginate with 50 records per page.
- Stock count lines also paginate; large counts are not rendered as one browser payload.
- List responses omit full movement/quotation snapshots. Detail/PDF requests load those on demand.
- Documents permit up to 100 lines. PDFs wrap long content and continue across pages.
- Filtered CSV export includes all matching records up to 10,000. Larger exports return a request to narrow filters; nothing is silently truncated. CSV formula protection is applied.
- Search spans shared products and authorized Quality, Warehouse, Production and Sales records.
- Schema changes, stock operations, approvals and permission changes appear in the existing administrative audit log.

## Local verification

`npm test` checks domain logic, decimal input, brand preservation and PDF content/pagination. `npm run test:db` resets **only the explicit disposable loopback database** and runs QC plus ERP transaction/security/concurrency cases. Never point tests at a live database. `npm run test:e2e` owns a production Next server and uses the existing disposable PostgREST adapter; its synthetic browser workflow covers production → QC-linked lot → quotation → order → reservation → partial delivery → stock count and mobile layouts.

Keep migrations 001–004 in order for a fresh installation. Review later migrations before changing the QC wrapper chain. To pause a live module, use Settings/read-only rather than deleting tables or records.
