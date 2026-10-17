# INBIONUSA reference template v1

Letterhead and Aptos font subsets originate from the user-supplied two-page COA reference. The reusable PDF was permanently redacted with PyMuPDF before inclusion: sample product, batch, certificate, results, declaration, and approval text are removed from the content streams, not covered with white rectangles. Corporate letterhead/logo and email/website footer are retained. Original application logo and palette are unchanged.

Runtime uses pdf-lib on Node (no browser, external font URL, or binary download). Aptos subsets retain the reference metrics for supported glyphs; bundled Liberation Sans is the fallback for characters absent from those subsets. See FONT-LICENSE.txt for the fallback font license. Dynamic text wraps within three columns; long content creates numbered continuation pages. English and Indonesian labels are selected explicitly; parameter translations are maintained with the specification.

Preview uses the same renderer with an explicit unissued mark. The sample's USP/NF/EP/BP/JP compliance statement is never applied automatically: the authorized issuer must supply the applicable statement.
