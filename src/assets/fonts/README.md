# DM Sans

Static DM Sans font files downloaded from Google Fonts (`fonts.gstatic.com`, DM Sans v17) for weights 400, 500, 600, 700 and regular italic. Served locally using `next/font/local`; no font request is made to Google when building or browsing the application. License: SIL Open Font License 1.1, included as `OFL.txt` from the Google Fonts DM Sans source.

Body text uses 400, controls 500, headings 600, and stronger emphasis 700. The official COA renderer retains the reference document's typography independently of the application UI.

The UI uses losslessly compressed WOFF2 copies generated with fontTools/Brotli from these same TTFs (same glyphs, weights and license). Keep TTF files for server PDF embedding; no remote font dependency is introduced.
