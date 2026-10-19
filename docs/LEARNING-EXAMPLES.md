# Learning examples: Finance and Service

Run the complete [seed SQL](../scripts/seed-learning.sql) in Supabase SQL Editor after migrations 001–013. Use a testing database: these synthetic records participate in real stock balances, dashboard totals and aging. They are not a performance dataset or commercial documents.

Activate Quality, Warehouse, Sales, Purchase, Service and Finance first in Administration → Module settings. The script never activates modules or changes existing user accounts. It uses an existing active administrator, creates an internal temporary session for the real business RPCs, and removes that session before committing. Existing sessions, passwords, grants and business records are unchanged. Stock is isolated in the DEMO-LEARN location.

Execute the complete file once. An error rolls back the seed. Re-running after success reports that DEMO-LEARN examples already exist rather than duplicating records. No schema migration or persistent helper function is installed. Current transactions use the actual QC/ERP RPCs; historical AR/AP documents are explicitly labeled opening balances inserted solely to demonstrate aging, without inventing historical SOs, POs or physical deliveries.

After success, the SQL result lists the scenario, customer, actual SO/billing/case number and next action. In the application's module table search, enter **DEMO-LEARN** or the exact document number from that result. Accounts and bank references are fictional. No bank transfer is made and no customer is contacted.

Each normal SO is **100 kg × IDR 100,000 = IDR 10,000,000**, with zero tax/freight to keep the examples easy to compare. The product is **INDOSTER 99001**, code **DEMO-LEARN-INDOSTER-99001**. Its specification, inspection and certificate are explicitly synthetic; do not use them for real quality release. The manual training lot is separate from real generated production series.

| Customer suffix | Where to start | What to learn / do next |
| --- | --- | --- |
| PREPAID-TERMS-PENDING | Finance → Dispatch clearance | Terms saved but pending. Approve terms before billing. |
| PREPAID-NO-PAYMENT | Finance → Invoices & billing | Issued payment request. Record actual receipt, verify, then allocate. |
| PAYMENT-DRAFT | Finance → Payments | Payment exists as Draft. Verification and allocation are still required. |
| VERIFIED-NOT-ALLOCATED | Finance → Payments | Funds are verified but do not clear dispatch until allocated. Do not record them again. |
| PREPAID-CLEARED | Finance → Dispatch clearance | Full IDR 10m allocated. Plan/reserve stock and create a delivery. |
| DP-BALANCE-BEFORE-SHIP | Finance → Dispatch clearance | IDR 3m DP received. Remaining IDR 7m is needed before shipping. |
| DP-PLUS-CREDIT | Finance → Dispatch clearance | IDR 3m DP plus approved credit. Shipping can proceed. Invoice trigger is Dispatch. |
| CREDIT-LIMIT-BLOCKED | Finance → Customer credit | IDR 10m exposure exceeds IDR 5m limit. Review the policy before shipping. |
| CREDIT-READY | Finance → Dispatch clearance | IDR 50m credit limit allows the IDR 10m order. Invoice is still unpaid. |
| RECEIPT-BEFORE-INVOICE | Service → Customer receipts | Delivery posted, POD missing. Record receipt before creating the invoice. |
| REFUND-PARTIAL | Service → Cases | IDR 1m approved; IDR 600k refunded. Record/verify/allocate the remaining IDR 400k before resolving. |
| REFUND-COMPLETE | Service → Cases | Full IDR 1m refund settled. Review evidence and resolve the case. |
| CREDIT-NOT-APPLIED | Finance → Invoices & billing | IDR 1m credit issued but not applied. Apply it to the original invoice, then resolve. |
| CREDIT-APPLIED | Service → Cases | Credit applied in full; original invoice balance is IDR 9m. Review and resolve. |
| CUSTOMER-RETURN | Warehouse → Returns | Request already created. Receive 10kg into quarantine before resolving the case. |
| REPLACEMENT | Service → Cases | Approved 10kg replacement, not shipped yet. Use the DEMO lot and location. |

The partial/full refund examples have a fully paid original invoice. Their outgoing refunds are separate verified payments allocated to the linked credit notes. The case's **approved settlement amount** is separate from handling/freight cost.

The remaining **10 scenarios** are historical AR/AP opening documents: customer and supplier balances of IDR 2m each in Current, 15, 45, 75 and 110 days overdue. Open Finance → AR / AP aging to compare the five buckets. These opening balances do not represent new goods arriving or shipping. Other existing business data will also appear in the aggregate aging report.

The script creates **no new users**, does not clear existing data, and does not install a cleanup procedure. Review/reset demo business data in the testing environment before using that environment for real operations.
