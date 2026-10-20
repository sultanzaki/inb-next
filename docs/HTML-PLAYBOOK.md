# INBIONUSA Operations Playbook

The deliverable is one self-contained file: [inbionusa-operations.html](../public/docs/inbionusa-operations.html). Download it and open it in a browser. Logo, DM Sans fonts, CSS and JavaScript are embedded; it has no CDN, analytics or database dependency.

It contains 29 Indonesian topics, retaining the application's English menu/button names: workspace map, master data, production, Quality/COA, warehouse, sales, payment terms, invoice triggers, billing, payment allocation, DP example, customer credit, aging, purchasing, Service, claims, settlements, corrections, product documents, CRM, access, module modes, errors, learning scenarios and glossary.

## Controls

- Document mode shows every section; the table of contents searches the full topic text.
- Presentation mode shows one topic. Use previous/next, Left/Right, Page Up/Page Down, Home/End, or the topic menu. Native input/button keyboard behavior is preserved.
- Full screen is available where the browser supports it.
- Print / PDF prints every topic in A4 landscape, even when only one slide is visible on screen.
- The payment-terms simulator is illustrative and changes no operational records.
- JavaScript-disabled browsers can still read and print the document.

The file is also served at `/docs/inbionusa-operations.html` by the application after deployment; the site's existing login middleware applies. No operational UI, permissions, database schema or migration is changed by this document.

Edition: 20 October 2026. This is a static guide, not a live dashboard or proof that a particular database has been migrated. Business descriptions were checked against the current operational Finance, release operations, learning examples and role documentation. Future feature changes should update this file explicitly.

Validation: Chromium document/presentation navigation, mobile topic menu/search, payment simulation, no external asset requests, JavaScript-disabled fallback, and print rendering. All 29 topics were checked for page overflow at 320, 375, 768 and 1440 px. Automated WCAG A/AA checks reported no violations in document mode; print output was 29 pages. Review captures and the diagnostic PDF are local verification artifacts, not additional deliverables.
