# Release: appearance, role-based access and operational insights

## Rollout

Apply `src/lib/db/migrations/007_release_access_insights.sql` **after 006**, then deploy the matching application. If the previous purchasing/CRM release is not migrated, apply 006 first. The application includes a compatibility fallback for the four legacy account roles while the database is updated; new operational roles fail closed if effective permissions cannot be loaded.

The migration is transactional and repeatable. It preserves current users, passwords, legacy administrator identities, existing per-user access rows, and operational records. No automatic promotion or demotion occurs. The existing validated QC evaluator is retained; its authorization gates are updated through exact, checked replacements. An unrecognized evaluator gate aborts the migration instead of guessing at its security policy. Historical RPC wrappers remain private.

Local tests are not a production migration. This release does not deploy the app or change the live Supabase project.

## Appearance

Choose Light, Dark or System from the account menu, or from the login page. The choice is stored on the device, applied before hydration through next-themes, and follows OS changes when System is selected. Navigation, tables, forms, dialogs, pickers, charts, status colors and notifications use shared semantic tokens. The light palette and original logo are retained; night surfaces use a deeper canvas with elevated panels, emerald accents and readable muted text. Server-generated COA and ERP PDFs keep their existing document design.

## Roles and permissions

The account editor lists the new operational roles and previews their module grants. Read permits viewing; Write permits operational entry; Approve permits approval/release decisions. Neither Write nor Approve grants system administration. Current administrators retain full role permissions; disabled/read-only module modes still govern operational work.

| Role | Main access | Supporting read access |
| --- | --- | --- |
| Administrator | All modules and user/access administration | All |
| Quality Manager | Quality and Documents read/write/approve | Warehouse, Production |
| Quality Officer | Quality and Documents read/write; no approval | Warehouse |
| Warehouse Manager | Warehouse read/write/approve | Purchase, Sales, Production, Documents |
| Warehouse Operator | Warehouse read/write; no approval | Purchase, Documents |
| Production Operator | Production read/write | Warehouse, Documents |
| Purchasing Manager | Purchase read/write/approve | Warehouse, Documents |
| Purchasing Officer | Purchase read/write; no approval | Warehouse, Documents |
| Sales Manager | Sales and CRM read/write/approve | Warehouse, Documents |
| Sales Officer | Sales and CRM read/write; no approval | Warehouse, Documents |
| Viewer | Existing Quality read-only default | Other modules only through explicit grants |

`admin qc` and `qc supervisor` remain supported as legacy identifiers; the UI labels them accordingly. Existing viewer accounts do not silently gain read access to every business module. Quality Supervisor retains its historical QC limits.

An explicit per-user module row replaces that module's role defaults, including explicit denials. This is shown as **User override** in the user editor's effective-access preview. **Restore role default** removes that exception. Module mode can further deny reading or writing, and the effective preview reflects that restriction.

Changing a user's role clears old per-user exceptions and revokes sessions. Changing/removing an exception also revokes that user's sessions. This prevents old access carrying over after a move to another job. Self-demotion/deactivation and last-administrator protections remain in the existing account management workflow.

### Business boundaries

- Quality Officers can record inspections and their own drafts, but cannot issue/update COAs or edit specifications without approval access. Quality approval controls COA issuance and specification changes. Destructive deletion and system/audit administration remain administrator-only.
- QC action visibility uses server-calculated effective permissions. Server actions and API routes check the same list; the database checks authorization before business validation and again through existing module/state guards.
- Warehouse receivers need Purchase read and Warehouse write to receive an existing confirmed PO. They do not need Purchase write and cannot thereby edit commercial terms or confirm a purchase.
- Receiving, approving orders, releasing lots and reversing transactions retain their workflow constraints. Warehouse receipt reversal still needs the appropriate approval grants in both modules.
- There is no custom role designer or field-level row ownership model in this release. Team module access is controlled by presets and explicit per-user exceptions. Inspection draft ownership remains enforced independently.

## Operational insights

Each operational workspace now has a compact, expandable **Operational insights** section. It loads only when opened, supports 7/30/90-day activity periods, provides a daily trend with accessible tabular data, and links to relevant workload lists. The dashboard remains the cross-module overview; Quality keeps its dedicated analytics page.

| Workspace | Essential decisions supported |
| --- | --- |
| Warehouse | Expiring finished lots, open stock counts, expired raw-material lots, current workload |
| Production | Posted/draft production records and batches awaiting quality release |
| Sales | Quotation activity, pending approvals, expiring quotations, open order value by currency |
| Purchase | Open/overdue orders, draft POs, materials below minimum, outstanding purchase value by currency |
| CRM | Open opportunities, overdue follow-ups, won/lost current stages, pipeline value by currency |
| Documents | Current revisions, drafts, expiring/expired published documents |

Activity counts/trends use the chosen period. Open workloads, warning counts and open commercial values are current snapshots. Monetary values remain exact decimal strings and are grouped by currency; unlike currencies are never added together. Production volumes in different units are not combined into a meaningless total. Server-side module read checks protect each insights endpoint.

## Suggested UI/UX follow-ups

These are recommendations, not additional features included in this release.

1. **Saved views:** named filter/sort/column configurations such as “My overdue follow-ups” or “Lots expiring soon”. Highest value for repetitive daily work; build on existing server filters and pagination.
2. **Favorites and recent records:** pin two or three workspaces and resume recently opened POs, lots or customers. Improves speed as module count grows without replacing the current navigation.
3. **Document activity timeline:** show status transitions, actor, time, reason and related revisions directly inside PO/COA/document details. The global audit log and CRM follow-up history already exist; this adds contextual business history.
4. **Form recovery:** recover unfinished input after accidental refresh or a temporary connection loss, with clear Saved/Saving/Offline feedback. Existing manual drafts and unsaved-change confirmation remain useful; this would improve recovery between saves.
5. **QR entry to lot traceability:** open an existing lot's traceability page from a physical label. Useful later for warehouse work; prioritize reliable records and labels before camera/barcode integration.
6. **Bulk work tools:** selected-row document downloads or task assignment with a clear preview. Lower priority while production and team size are small.

If scope must stay small before launch, prioritize saved views and contextual history next; favorites, recovery and QR can follow actual team usage. Do not add another onboarding/shortcut menu or redesign the current navigation to deliver these improvements.

## Validation

- `npm run test:db`: existing QC/ERP cases plus role defaults, explicit denials, session revocation, role changes, receiver separation, QC authorization, private helpers and insights permissions.
- `npm test`: unchanged business/PDF behavior, base light palette/logo, input validation and exports.
- `npm run test:e2e`: existing workflows plus dark surfaces on desktop/mobile, Light/Dark/System persistence, OS preference changes, public login appearance, role previews, accessible insights and a fresh Quality Officer session with denied certification/admin requests.
- Focused browser iteration: `TEST_RELEASE_READY_ONLY=1 npm run test:e2e`, after local database setup and production build.
