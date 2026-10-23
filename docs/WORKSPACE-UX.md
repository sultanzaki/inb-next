# Workspace interaction improvements

- Desktop workspace directory: three columns on tablets/narrow desktops, four on wide screens. Mobile keeps two columns.
- Desktop navigation: one expanded module, optional functional subgroups for long modules, page search, automatic selection on navigation, native keyboard-operable disclosure controls. Links continue to use the same permission-filtered source as mobile navigation.
- Numeric fields remain read-only until hydration to avoid losing early typing.
- Numeric fields: non-editable currency/percentage/unit adornments; stored values remain canonical numbers. Material and product units resolve from selected records. Unknown units ask the operator to select a source instead of assuming kilograms. Each adornment is described to screen readers.
- PDF approval records: final manufacturing/material usage records, finalized incoming inspection reports, dispatched/closed warehouse transfers, and supported issued commercial documents can show a system-recorded approval panel. Evidence comes from the existing session-authorized immutable history readers. The panel contains the actual actor, action, Jakarta timestamp, audit ID and record ID. Drafts and historical records without suitable events receive no invented approval. A finalized FAIL inspection attests the report, not a release of the material.
- This is an internal approval record, not a certificate-based digital signature. The existing COA reference layout and its release process remain separate.
- No new database privileges, schema migrations or external signing provider are required.

Verification includes all new-record forms at desktop/mobile widths in both themes, reference selector surfaces and geometry, unit resolution, canonical numeric entry, workspace grid, navigation state/search, and final inspection PDF generation through authenticated APIs. The existing operational browser tests still create, save and export records against a disposable local database; no production fixtures are written.
