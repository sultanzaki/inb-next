# Interaction stability audit — 23 October 2026

This pass concentrates on shared interaction defects before adding more features. Changes apply across existing forms and workspaces. There are no schema migrations or production data changes.

## Findings and changes

| Area | Finding | Change |
| --- | --- | --- |
| Modal entry | The underlying page was visibly readable through forms during opacity animation, even though resting screenshots looked correct. | Dialog surfaces stay opaque throughout entry/exit; only a small scale transition is applied. Sheets keep movement without surface fading. The backdrop still fades. |
| Page transitions | Workspace content used both browser snapshot transitions and a CSS entrance animation. Query-only navigation could also start a page transition while a form was opening. | Removed the page-wide snapshot wrapper; retained ordinary route entrance animation. Skip redundant URL replacement when the selected record has not changed. |
| Closing forms | ERP modal dismissal unmounted the popup immediately. Dirty/busy checks queried every ERP form on the page, including other dialogs. | Keep the modal through its close lifecycle; scope checks to its own content; guard concurrent close requests. Operational action launchers wait for the current form to close. |
| Confirmation | Clearing confirmation options at close removed the heading and action before the closing surface finished. | Keep confirmation text until close completion. Canceling discard preserves form values. |
| Unsaved work | ERP forms lacked the hard-navigation protection already present on quality forms. | Add browser unload protection for dirty/saving ERP forms. This covers refresh/closing the page, not a new global router guard. |
| Reference search | Debounced search briefly left old options clickable. Failed/missing selected records could say “Loading selection…” indefinitely. | Hide stale options as soon as search text changes; show meaningful selection failure/unavailable messages; preserve retry. Use the returned page size for pagination. |
| Keyboard selection | New operational reference choices required tabbing through every option. | Arrow Up/Down and Home/End move through options; Enter selects; Escape closes and restores focus. Home/End retain text-editing behavior in search. |
| Dependent references | Changing a source did not clear all choices scoped to that source, such as stock lots/pallets after changing a transfer source location. | Clear scoped references, including nested lines, while preserving quantities and unrelated values. Existing server validation remains authoritative. |
| Inspection entry | Result fields remained editable while a save was pending; zero limits could display as “No minimum/maximum.” | Disable result editing while saving; preserve zero limits; associate result validation messages with the affected input. |
| Small screens | Long generic introductory text consumed much of the working area. Some non-ERP input styles were below the iOS automatic-zoom threshold. | Put optional form explanations in an accessible disclosure (confirmation instructions start expanded), omit empty generic subtitles, and use 16px mobile inputs. |
| Overlay bounds/focus | Generic dialogs did not guarantee vertical scrolling; popovers lacked a shared edge margin. Initial focus could target hidden/read-only inputs. | Dynamic viewport height, contained scrolling, popover width/edge constraints, and visible editable initial-focus candidates. |
| Select consistency | A blank controlled select could visually show its first option. | Explicit empty placeholder prevents a misleading selected appearance. Existing configured defaults remain intact. |

## Verification

- Added intermediate-frame assertions for opaque forms and retained closing content; repeated open/close/discard flows at 320, 390, 768 and 1440px.
- Added keyboard/focus restoration and delayed/error/retry search checks.
- Added a delayed incoming-inspection save check: results disable, Escape cannot close the saving form, and only one save is dispatched.
- Added domain regression coverage for source changes invalidating nested references without mutating prior state.
- Existing full browser coverage includes quality/COA, ERP transactions, manufacturing, warehouse, purchase, CRM, documents, finance/service, role checks, tables, exports, record loading, numeric editing and mobile navigation; new operational forms are checked in light and dark themes.
- Database tests use an explicitly guarded disposable loopback PostgreSQL database. Browser fixtures and API mutations also run locally.

Unit/domain tests: 47 passed. Database integration tests: 135 passed. PostgREST access/search tests: 3 passed. Production build and lint passed. Targeted interaction browser checks passed. Full authenticated browser regression passed (405 seconds), including the new interaction checks. TypeScript and diff checks also passed. Browser coverage uses Chromium and responsive viewports. Physical iOS/Android keyboard and assistive-technology behavior still require device testing; an automated pass is not a guarantee that every possible bug has been eliminated.
