# INBIONUSA Operations Slides

The deliverable is one self-contained HTML slideshow: [inbionusa-operations.html](../public/docs/inbionusa-operations.html). Download it and open it in a browser. Logo, DM Sans fonts, CSS and JavaScript are embedded; it has no CDN, analytics or database dependency.

The deck contains 35 slides in Indonesian, retaining the application's English menu/button names. Topics cover workspaces, master data, production, Quality/COA, warehouse, sales, payment terms, invoice triggers, billing, payment allocation, customer credit, aging, purchasing, Service, claims, settlements, corrections, product documents, CRM, access, module modes, errors, learning scenarios and glossary.

## Controls

- One 16:9 slide is visible at a time, fitted to the viewport without page scrolling.
- Click **Mulai fullscreen** to enter fullscreen. Browsers require a user gesture; fullscreen cannot start automatically.
- Navigate with previous/next, Left/Right, Page Up/Page Down, Home/End, or **Daftar slide**.
- Press **F** to toggle fullscreen. Space advances outside form controls.
- Presentation controls fade when idle and reappear on interaction.
- The payment-terms simulator is illustrative and changes no operational records.

JavaScript is required for slide navigation. Landscape orientation is recommended on phones to make the presentation easier to read.

The file is also served at `/docs/inbionusa-operations.html` by the application after deployment; the site's existing login middleware applies. No operational UI, permissions, database schema or migration is changed by this presentation.

Edition: 20 October 2026. This is a static guide, not a live dashboard or proof that a particular database has been migrated. Future feature changes should update this file explicitly.

Validation: Chromium fullscreen entry/exit, keyboard navigation, slide index, payment simulation, and no external asset requests or JavaScript errors. All 35 slides were checked for scrolling and content clipping at 375, 768, 1440 and 1920 px. Automated WCAG A/AA checks on the interactive simulator slide reported no violations.
