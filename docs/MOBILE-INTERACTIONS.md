# Mobile parameters, filters, navigation, and logout

## Behavior

- Product specifications and version history use readable parameter cards below 768px. Inspection and COA results use cards with a standard, actual result, unit, and status. Desktop retains tables.
- Product detail dialogs retain the intrinsic height of their content. Long metadata no longer collapses parameter tables, and long parameter names and values wrap inside the dialog.
- Advanced filters open a bottom sheet on mobile. Edits remain local until Apply filters; Clear removes applied filters too. Invalid date ranges cannot be applied. Exports continue to use the applied filters. Empty states and Clear filters recognize advanced filters across the four record lists.
- The dashboard no longer offers a Refresh button. Failed requests still offer Retry.
- Logout returns an explicit server result and navigates after session revocation succeeds. The shell and mandatory password-change screen share the same logout hook. A genuine revocation failure keeps the existing session and offers retry; successful logout does not show a failure toast.
- Mobile navigation opens a compact workspace launcher with labeled module cards, the current location, and cross-module search. Existing permission filtering still controls the available modules. Search waits for the launcher to close before opening, preserving dialog focus.
- Short card entrances, button press feedback, icon movement, and copy confirmation add motion without delaying navigation. Reduced-motion preferences disable decorative motion.

## Design reference

The accessible source reference was shadcn's navigation-menu example:
https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/examples/navigation-menu-demo.tsx

Its labeled destination groups informed the navigation structure; this implementation uses the existing Base UI sheet and the application's palette, logo, and typography. Visual reference sites were unavailable from this environment.

## Validation

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
Run `npm run test:e2e` with the disposable PostgreSQL/PostgREST services described in the existing test documentation. The production browser suite covers mobile navigation, long parameter cards at 320px and 375px, filter application/clearing, invalid date ranges, accessibility checks, and both successful and failed logout. It uses local synthetic accounts and data.

No database migration or new dependency is required.
