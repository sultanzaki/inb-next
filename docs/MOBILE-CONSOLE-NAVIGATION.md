# Mobile console navigation

This revision supersedes the Home / Work / Search bottom navigation described in the operations design notes. Desktop retains its existing sidebar and topbar.

Below 768px, a sticky console header presents two levels:

- Workspace row: existing logo links Home; workspace picker; equally sized search and account controls.
- Page row: current destination and a dropdown containing the active workspace's pages. URL query parameters determine the selected view, including Warehouse Returns and Master data Units.

Workspace/page options use the same module and role visibility as desktop. Search and account controls remain available on every page. All workspaces is an optional directory, not a required navigation step. Mobile ERP pages no longer duplicate the page selector inside their content.

Menus fit within symmetric viewport margins and scroll on short screens. Escape dismisses the menu and restores trigger focus. Full-screen forms retain their established editor/footer behavior and cover the header while open. The existing palette, logo and DM Sans are retained. No database migration or credential changes are required.

Verification includes browser navigation at 320/375/430px, active-page markers, access to units and returns, search/account actions, focus restoration, overflow/accessibility checks, and a desktop layout check. The normal browser regression continues to cover QC, ERP, mobile editors and logout.
