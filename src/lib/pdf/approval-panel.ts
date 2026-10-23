import { rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { approvalLines, type ApprovalStamp } from "./approval";

/** A bounded approval seal, with actual audit identity rather than a simulated signature. */
export function approvalPanel(
  stamp: ApprovalStamp,
  width: number,
  fontFor: (text: string, bold?: boolean) => PDFFont,
) {
  function wrap(text: string, available: number, size: number) {
    const lines: string[] = [];
    let current = "";
    for (const character of text.replace(/[\r\n\t]/g, " ")) {
      const next = current + character;
      if (
        current &&
        fontFor(next, true).widthOfTextAtSize(next, size) > available
      ) {
        lines.push(current);
        current = character;
      } else current = next;
    }
    if (current) lines.push(current);
    return lines;
  }
  const rows = approvalLines(stamp).map(([label, value]) => ({
    label,
    lines: wrap(value, width - 152, 8.5),
  }));
  const note = wrap(
    "Internal approval record. Verify the audit reference in document history. Not a certificate-based digital signature.",
    width - 28,
    7.2,
  );
  const height =
    34 +
    rows.reduce((n, row) => n + row.lines.length * 12 + 5, 0) +
    note.length * 10 +
    16;
  return {
    height,
    draw(page: PDFPage, x: number, top: number) {
      page.drawRectangle({
        x,
        y: top - height,
        width,
        height,
        color: rgb(0.96, 0.98, 0.97),
        borderColor: rgb(0.09, 0.4, 0.29),
        borderWidth: 0.7,
      });
      let y = top - 18;
      const draw = (value: string, left: number, size: number, bold = false) =>
        page.drawText(value, {
          x: left,
          y,
          size,
          font: fontFor(value, bold),
          color: rgb(0.12, 0.28, 0.21),
        });
      draw("SYSTEM-RECORDED APPROVAL", x + 14, 9, true);
      y -= 20;
      for (const row of rows) {
        draw(row.label, x + 14, 7.5);
        for (const line of row.lines) {
          draw(line, x + 138, 8.5, true);
          y -= 12;
        }
        y -= 5;
      }
      y -= 3;
      for (const line of note) {
        draw(line, x + 14, 7.2);
        y -= 10;
      }
    },
  };
}
