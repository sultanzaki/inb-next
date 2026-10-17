# Workspace typography, English UI, and mobile tables

The workspace now uses self-hosted DM Sans: 400 for body text, 500 for controls, 600 for headings and table headers, and 700 where stronger emphasis is needed. Font files and the OFL license are bundled; builds and browsers do not need Google Fonts. The existing brand palette and logo are unchanged, as requested after the reference website could not be accessed.

Spacing is tighter across the workspace: 24/32 px desktop content padding, 16/20 px mobile padding, 16–18 px section gaps, smaller page headings and summary figures, and approximately 48 px data rows. Touch controls retain their usable hit areas.

On mobile, row actions move into a keyboard-accessible three-dot menu. Desktop keeps the existing direct actions. The sticky mobile action column is limited to 56 px rather than allowing several icons to cover the data. Copy actions, permission checks, document links, PDF downloads, and delete confirmations are retained.

Dialogs wrap long titles, identifiers, notes, and metadata. Tables inside dialogs wrap cell contents within the dialog width; the page does not scroll horizontally. Read-only dialogs open at the top rather than focusing an action at the bottom. Forms retain field focus on desktop, and touch interaction does not force the virtual keyboard open.

All application-owned navigation, labels, hints, empty states, loading messages, validation messages, notifications, errors and export headers use concise English. Dates and number formatting use English conventions while business dates and timestamps remain tied to Asia/Jakarta. Stored product names, notes, document titles, database identifiers, role values, and audit payloads are preserved. The official COA template and its explicit Indonesian/English document selection remain available.

Products, inspections, COAs, documents, users, and audit logs fetch one server page at a time. Pagination provides previous/next, numbered pages on desktop, a compact page indicator on mobile, and the current row range. Searches and filters restart at page one. A failed page request preserves the current rows and page so it can be retried. Specification history is also paged instead of appending older versions. Drafts retain their existing previous/next navigation. Dashboard summary tables intentionally show their fixed recent-record subset.

No database migration or credential change is required for this revision. The database must already have migrations 001–003 from the previous release.

Validation includes the existing domain/PDF, PostgreSQL, HTTP and production-browser suites. Browser coverage checks all six paginated modules, specification-history pages, page replacement and back navigation, filter reset, permissions, three-dot actions, DM Sans loading, accessibility, and long modal content at 320 and 375 px. The existing COA issuance, account reset, filtered exports, and logout workflows are retained in the regression scenario.
