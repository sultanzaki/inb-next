# Operational UX — phases 1–3

## Rollout

Apply `src/lib/db/migrations/014_operational_ux.sql` **after 013 and before deploying this application version**. It is repeatable and adds authorized read models; it does not clear or rewrite business records, change payment clearance rules, or activate modules. Verify in staging first. Existing records, role permissions and server-side posting checks remain authoritative.

Deployment record — 20 October 2026: migration 014 was applied to the configured Supabase project through the Management API after checking migration 013 prerequisites. All four new RPCs were verified to allow server-role execution and deny direct anonymous/authenticated execution. No business-data reset was performed.

## Phase 1: shared inputs and feedback

- ERP decimal inputs display Indonesian grouping and decimal separators. `1.250.000,50` is submitted as `1250000.50`. `Rp`/`IDR` prefixes and spaces can be pasted. Ambiguous/invalid punctuation is rejected instead of guessed. Grouping is applied on blur; the edit buffer preserves cursor position while typing.
- Empty and zero remain distinct. Suggestions use six-place integer arithmetic. Display totals are estimates; the database calculates final amounts.
- Quality measurement results retain their existing raw numeric/scientific-entry behavior.
- ERP forms validate the same schemas as their APIs, show field messages and a linked summary, focus the first problem, preserve entered values, and prevent duplicate submit.
- Quality forms share readable validation messages. Common database failures map to business explanations and relevant fields instead of exposing generic constraint errors.
- Payment modes and invoice triggers have readable labels and tap/keyboard-accessible contextual help. Help does not change internal enum values.

## Phase 2: document context

- Pickers show party, product/lot, date, status, amount and remaining balance when present in their authorized read model. Selection details can be reviewed inline.
- Finance search includes customer/supplier/product context rather than only document numbers.
- Verified payment, issued document and posted-delivery filters are applied **before pagination**, with party, currency, order, direction and positive-balance constraints where applicable.
- Linked document flows are available on order, delivery, quotation, purchase and Finance details. Only modules the actor may read appear. Links open a separate tab to retain the current form/list.
- Order-level actions open billing with the source selected. Issued billing can open payment recording with party/currency/amount context. Newly created billing/payments open their detail for the next action; verified payments can start allocation with the payment preselected. Record deep links open the referenced detail.
- Existing modal-based lists retain list state while viewing/editing. Returning browser focus refreshes mounted read models; the server still rechecks data at submit.

## Phase 3: operational flows

- Payment requests offer approved-terms, deposit, remaining-unrequested and custom purposes. For a 60m order / 30% DP, the initial suggestion is 18m. Existing non-void requests reduce the next suggestion; the linked request and outstanding balance are visible. Partial receipts belong to the existing request rather than generating another request for the same DP.
- Verified allocated funds are shown separately from requested funds. Suggestions do not treat a draft request as received money.
- Allocation defaults to the smaller of available verified funds and document outstanding balance. Users still review and explicitly save.
- Billing displays terms approval, invoice trigger and existing requests. Dispatch/receipt invoicing asks for a posted delivery from the same SO; order-trigger billing omits that unnecessary picker. Invoice quantities can use remaining amounts from the order/delivery read model.
- Due date defaults from the selected order's agreed days. Quotation/purchase forms show live estimated totals; purchase receiving offers remaining quantities per line.
- Draft DO details show current stock/release/expiry/certificate/financial checks together. Posting always runs the existing server validations again.
- Production forms show a batch/expiry preview before posting, including missing-series guidance. The preview is not a reservation; numbering is assigned at posting.
- Existing Quality drafts, live parameter evaluation, COA preview, CRM source links, reservations and controlled corrections are retained.

## Verification

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. Database checks use only the disposable PostgreSQL/PostgREST services described in the repository: `npm run test:db`. `TEST_UX_ONLY=1 npm run test:e2e` exercises the production build with local fixtures for DP calculations, localized money input, inline validation, partial allocation, mobile help and accessibility. Full browser regression remains `npm run test:e2e`. `TEST_UX_MISSING_RPC=1 npm run test:e2e` verifies the rollout fallback: ordinary pickers retain the legacy authorized read path; scoped choices stop with deployment guidance rather than silently removing financial filters. Automatic request amounts are not guessed when the billing summary is unavailable.

Phases 4–6 (new tolerance/approval policies, closing remaining order quantities, expanded worklists, price lists, barcode and manufacturing genealogy) are outside this release. No automatic posting, approval, verification or bank transfer is introduced.
