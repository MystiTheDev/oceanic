/* ---------------------------------------------------------------------------
 * "PDF with annotations": pdf-lib draws every annotation onto a copy of the
 * original. Highlights become semi-transparent rects, underline/strike lines,
 * ink filled outlines, shapes native paths, text drawText, and sticky notes
 * an icon plus a real PDF text annotation (shows as a comment in readers).
 * ------------------------------------------------------------------------ */
import {
  BlendMode,
  PDFDocument,
  PDFHexString,
  StandardFonts,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { PdfAnnotationRecord } from "../data/api";
import { STICKY_SIZE, arrowHead, fromRecord, inkOutline, type Ann } from "./annotations";

const color = (hex: string) => {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/**
 * Page display space (what pdf.js shows at scale 1: points, origin top-left,
 * after /Rotate) → PDF user space, as [a b c d e f].
 */
function displayToPdf(page: PDFPage): [number, number, number, number, number, number] {
  const { x: cx, y: cy, width: W, height: H } = page.getCropBox();
  switch (((page.getRotation().angle % 360) + 360) % 360) {
    case 90:
      return [0, 1, 1, 0, cx, cy];
    case 180:
      return [-1, 0, 0, 1, cx + W, cy];
    case 270:
      return [0, -1, -1, 0, cx + W, cy + H];
    default:
      return [1, 0, 0, -1, cx, cy + H];
  }
}
const apply = (m: number[], x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Standard fonts only cover WinAnsi; anything else becomes "?". */
const encodable = (font: PDFFont, text: string) =>
  [...text]
    .map((ch) => {
      try {
        font.encodeText(ch);
        return ch;
      } catch {
        return "?";
      }
    })
    .join("");

/** Greedy word wrap to `width` points. */
function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && font.widthOfTextAtSize(next.trimEnd(), size) > width) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else line = next;
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** Draw one annotation in display coordinates (the caller set up the matrix). */
function draw(page: PDFPage, a: Ann, font: PDFFont) {
  const d = a.data;
  const c = color(a.color);
  const w = d.width ?? 2;
  const path = (p: string, opts: Parameters<PDFPage["drawSvgPath"]>[1]) => page.drawSvgPath(p, { x: 0, y: 0, ...opts });
  switch (a.kind) {
    case "highlight":
      for (const r of d.rects ?? []) path(`M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}Z`, { color: c, opacity: 0.4, blendMode: BlendMode.Multiply });
      break;
    case "underline":
    case "strike":
      for (const r of d.rects ?? []) {
        const y = r.y + r.h * (a.kind === "underline" ? 0.94 : 0.55);
        path(`M${r.x} ${y}H${r.x + r.w}`, { borderColor: c, borderWidth: Math.max(0.8, r.h * 0.08) });
      }
      break;
    case "ink":
      if (d.points?.length) path(inkOutline(d.points, w), { color: c });
      break;
    case "rect":
      if (d.box) path(`M${d.box.x} ${d.box.y}h${d.box.w}v${d.box.h}h${-d.box.w}Z`, { borderColor: c, borderWidth: w });
      break;
    case "ellipse":
      if (d.box) {
        const { x, y, w: bw, h: bh } = d.box;
        const [rx, ry] = [bw / 2, bh / 2];
        path(`M${x} ${y + ry}A${rx} ${ry} 0 1 0 ${x + bw} ${y + ry}A${rx} ${ry} 0 1 0 ${x} ${y + ry}Z`, { borderColor: c, borderWidth: w });
      }
      break;
    case "line":
    case "arrow":
      if (d.from && d.to) {
        path(`M${d.from.x} ${d.from.y}L${d.to.x} ${d.to.y}`, { borderColor: c, borderWidth: w, borderLineCap: 1 });
        if (a.kind === "arrow") path(arrowHead(d.from, d.to, w), { color: c });
      }
      break;
    case "text":
      if (d.box && d.text) {
        const size = d.width ?? 12;
        wrap(font, encodable(font, d.text), size, d.box.w).forEach((line, i) => {
          const baseline = d.box!.y + size * (i + 1) * 1.25 - size * 0.3;
          if (baseline <= d.box!.y + d.box!.h + size) page.drawText(line, { x: d.box!.x, y: -baseline, size, font, color: c });
        });
      }
      break;
    case "sticky":
      if (d.box) {
        const { x, y } = d.box;
        path(`M${x + 2} ${y}h14l6 6v14a2 2 0 0 1-2 2H${x + 2}a2 2 0 0 1-2-2V${y + 2}a2 2 0 0 1 2-2z`, { color: c, borderColor: rgb(0.4, 0.4, 0.4), borderWidth: 0.6 });
        path(`M${x + 5} ${y + 9}h11M${x + 5} ${y + 13}h11M${x + 5} ${y + 17}h7`, { borderColor: rgb(0.3, 0.3, 0.3), borderWidth: 1.2 });
      }
      break;
  }
}

/** A copy of `original` with the annotations drawn in. */
export async function annotatedPdf(original: Uint8Array, records: PdfAnnotationRecord[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  for (const a of records.map(fromRecord)) {
    const page = pages[a.page - 1];
    if (!page) continue;
    const m = displayToPdf(page);
    // drawSvgPath flips y itself, so pre-flip: user = M · diag(1, -1) · svg.
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(m[0], m[1], -m[2], -m[3], m[4], m[5]));
    draw(page, a, font);
    page.pushOperators(popGraphicsState());

    if (a.kind === "sticky" && a.data.box) {
      // The note itself, as a real comment other PDF readers can open.
      const { x, y } = a.data.box;
      const [x1, y1] = apply(m, x, y);
      const [x2, y2] = apply(m, x + STICKY_SIZE, y + STICKY_SIZE);
      const c = color(a.color);
      const annot = doc.context.obj({
        Type: "Annot",
        Subtype: "Text",
        Rect: [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)],
        Contents: PDFHexString.fromText(a.data.text ?? ""),
        T: PDFHexString.fromText("Oceanic"),
        Name: "Comment",
        C: [c.red, c.green, c.blue],
        F: 4,
        Open: false,
      });
      page.node.addAnnot(doc.context.register(annot));
    }
  }
  return doc.save();
}

/** "Lecture.pdf" → "Lecture (annotated).pdf". */
export const annotatedName = (name: string) => `${name.replace(/\.pdf$/i, "") || "Document"} (annotated).pdf`;
