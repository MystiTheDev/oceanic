import JSZip from "jszip";
import { readDocx } from "./docxReader";
import {
  AlignmentType, BorderStyle, TabStopType, HorizontalPositionAlign, HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType, TextWrappingSide, Document, ImageRun, PageBorderDisplay, PageBorderOffsetFrom, ExternalHyperlink, Footer, Header, HeadingLevel, LevelFormat, Packer, PageBreak, PageNumber,
  PageOrientation, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType, type ParagraphChild,
} from "docx";
import type { JSONContent } from "@tiptap/core";

/** Page setup, stored in the .docx section and in our custom property. */
export type PageSetup = {
  size: "A4" | "Letter";
  orientation: "portrait" | "landscape";
  /** Margins in mm. */
  margin: { top: number; right: number; bottom: number; left: number };
  header: string;
  footer: string;
  pageNumbers: boolean;
  border?: PageBorder;
};
/** Word page border (Layout → Page borders). Width/space in points. */
export type PageBorder = {
  style: "single" | "dashed" | "dotted" | "double";
  width: number;
  color: string;
  sides: { top: boolean; right: boolean; bottom: boolean; left: boolean };
  from: "page" | "text";
  space: number;
};
export const DEFAULT_PAGE: PageSetup = {
  size: "A4",
  orientation: "portrait",
  margin: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
  header: "",
  footer: "",
  pageNumbers: false,
};
export const PAGE_MM = { A4: { w: 210, h: 297 }, Letter: { w: 215.9, h: 279.4 } };

export type LoadedDoc = { content: JSONContent | string; page: PageSetup; lossy: boolean };

/* ------------------------------------------------------------------ import */
/**
 * Our own saves carry the editor JSON in a custom property, so formatting
 * survives the round trip. If the text no longer matches (edited in Word),
 * fall back to mammoth's HTML, which keeps structure but drops some styling.
 */
export async function importDocx(bytes: Uint8Array): Promise<LoadedDoc> {
  if (!bytes.length) return { content: "<p></p>", page: DEFAULT_PAGE, lossy: false };
  // Every file, ours or Word's, is read from Word's own XML (no hidden copy:
  // Word limits custom properties to 255 characters and flags bigger ones).
  return readDocx(await JSZip.loadAsync(bytes));
}

/** Was this file written by Oceanic Docs? (Its core properties name us as the creator.) */
export async function isOceanicDoc(bytes: Uint8Array) {
  if (!bytes.length) return true;
  try {
    const core = await (await JSZip.loadAsync(bytes)).file("docProps/core.xml")?.async("string");
    return !!core && /<dc:creator>Oceanic Docs<\/dc:creator>/.test(core);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ export */
const mmToTwip = (mm: number) => Math.round((mm / 25.4) * 1440);
const hex = (c?: string) => {
  if (!c) return undefined;
  if (c.startsWith("#")) return c.slice(1, 7).padEnd(6, "0");
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("") : undefined;
};
const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED } as const;
const HEADINGS = [HeadingLevel.TITLE, HeadingLevel.TITLE, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];

/** Inline image → Word run (width/alignment carried on the node). */
function imageChild(n: JSONContent): ParagraphChild[] {
  const img = images.get(n.attrs?.src);
  if (!img) return [];
  // Cap to the A4 text column (~160mm ≈ 605px) so nothing overflows the page.
  const width = Math.min(Number(n.attrs?.width) || img.w, 600);
  const height = Math.round(img.h * (width / img.w));
  const float = n.attrs?.float as "left" | "right" | undefined;
  return [
    new ImageRun({
      data: img.data,
      type: img.type,
      transformation: { width, height },
      // Wrapped (floating) pictures stay floating in Word.
      floating: float
        ? {
            horizontalPosition: { relative: HorizontalPositionRelativeFrom.COLUMN, align: float === "left" ? HorizontalPositionAlign.LEFT : HorizontalPositionAlign.RIGHT },
            verticalPosition: { relative: VerticalPositionRelativeFrom.PARAGRAPH, offset: 0 },
            wrap: { type: TextWrappingType.SQUARE, side: float === "left" ? TextWrappingSide.RIGHT : TextWrappingSide.LEFT },
            margins: { left: 114300, right: 114300 },
          }
        : undefined,
    }),
  ];
}

function runs(nodes: JSONContent[] = []): ParagraphChild[] {
  return nodes.flatMap((n): ParagraphChild[] => {
    if (n.type === "hardBreak") return [new TextRun({ break: 1 })];
    if (n.type === "image") return imageChild(n);
    if (n.type !== "text") return [];
    const marks = Object.fromEntries((n.marks ?? []).map((m) => [m.type, m.attrs ?? {}]));
    const style = marks.textStyle ?? {};
    const size = parseFloat(style.fontSize ?? "");
    const run = new TextRun({
      text: n.text ?? "",
      bold: !!marks.bold,
      italics: !!marks.italic,
      underline: marks.underline ? {} : undefined,
      strike: !!marks.strike,
      color: hex(style.color),
      font: style.fontFamily?.split(",")[0].replace(/["']/g, "").trim() || undefined,
      size: size ? Math.round(size * 2) : undefined,
      shading: marks.highlight ? { type: ShadingType.CLEAR, fill: hex(marks.highlight.color) ?? "FFF59D", color: "auto" } : undefined,
    });
    return marks.link?.href ? [new ExternalHyperlink({ link: marks.link.href, children: [run] })] : [run];
  });
}

/** Image bytes + pixel size, loaded before export (docx needs both).
    The cache PERSISTS across saves — an autosave re-uses already-decoded
    images instead of refetching/decoding 75 PNGs every second. */
type Img = { data: Uint8Array; type: "png" | "jpg" | "gif" | "bmp"; w: number; h: number };
const images = new Map<string, Img>();
/** Drop all cached images (call when loading a NEW document). */
export function resetImageCache() {
  images.clear();
}
async function loadImages(n: JSONContent, out: Map<string, Img>) {
  if (n.type === "image" && n.attrs?.src && !out.has(n.attrs.src)) {
    try {
      const src: string = n.attrs.src;
      const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer());
      const el = new window.Image();
      el.src = src;
      await el.decode();
      const kind = (src.match(/^data:image\/(\w+)/)?.[1] ?? src.split(".").pop() ?? "png").toLowerCase();
      const type = kind === "jpeg" || kind === "jpg" ? "jpg" : kind === "gif" ? "gif" : kind === "bmp" ? "bmp" : "png";
      // Fit the text width (~6.3in at 96dpi), keep the aspect ratio.
      const scale = Math.min(1, 605 / el.naturalWidth);
      out.set(src, { data: bytes, type, w: Math.round(el.naturalWidth * scale), h: Math.round(el.naturalHeight * scale) });
    } catch {}
  }
  for (const c of n.content ?? []) await loadImages(c, out);
}

function blocks(nodes: JSONContent[] = [], list?: { ref: string; level: number }): (Paragraph | Table)[] {
  return nodes.flatMap((n): (Paragraph | Table)[] => {
    const align = ALIGN[(n.attrs?.textAlign as keyof typeof ALIGN) ?? "left"];
    const a = n.attrs ?? {};
    const tw = (pt: unknown) => (pt == null ? undefined : Math.round(Number(pt) * 20));
    const spacing = { line: a.lineHeight ? Math.round(parseFloat(a.lineHeight) * 240) : undefined, before: tw(a.spaceBefore), after: tw(a.spaceAfter) };
    const tabStops = a.tabStop ? [{ type: TabStopType.LEFT, position: tw(Number(a.tabStop) + Number(a.indentLeft ?? 0))! }] : undefined;
    const first = a.indentFirst == null ? undefined : Number(a.indentFirst);
    const indent = a.indentLeft || a.indentRight || first
      ? { left: tw(a.indentLeft), right: tw(a.indentRight), firstLine: first && first > 0 ? tw(first) : undefined, hanging: first && first < 0 ? tw(-first) : undefined }
      : undefined;
    switch (n.type) {
      case "paragraph":
        return [new Paragraph({ children: runs(n.content), alignment: align, spacing, indent, tabStops, numbering: list && { reference: list.ref, level: list.level } })];
      case "heading":
        return [new Paragraph({ children: runs(n.content), heading: HEADINGS[n.attrs?.level ?? 1], alignment: align, spacing, indent })];
      case "bulletList":
      case "orderedList":
        return (n.content ?? []).flatMap((item) =>
          blocks(item.content, { ref: n.type === "bulletList" ? "bullets" : "numbers", level: list ? Math.min(list.level + 1, 8) : 0 }),
        );
      case "blockquote":
        return blocks(n.content).map((p) => p);
      case "image": {
        // Legacy: standalone image blocks (now wrapped by migration on load).
        return [new Paragraph({ children: imageChild(n), alignment: align })];
      }
      case "pageBreak":
        return [new Paragraph({ children: [new PageBreak()] })];
      case "horizontalRule":
        return [new Paragraph({ border: { bottom: { style: "single", size: 6, color: "999999", space: 1 } } })];
      case "table":
        return [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: (n.content ?? []).map(
              (row) =>
                new TableRow({
                  children: (row.content ?? []).map(
                    (cell) =>
                      new TableCell({
                        children: blocks(cell.content).filter((b): b is Paragraph => b instanceof Paragraph),
                        columnSpan: cell.attrs?.colspan > 1 ? cell.attrs!.colspan : undefined,
                        width: cell.attrs?.colwidth ? { size: (cell.attrs.colwidth as number[]).reduce((x, y) => x + y, 0) * 15, type: WidthType.DXA } : undefined,
                      }),
                  ),
                }),
            ),
          }),
        ];
      default:
        return n.content ? blocks(n.content, list) : [];
    }
  });
}

function pageBorders(b: PageBorder) {
  const style = { single: BorderStyle.SINGLE, dashed: BorderStyle.DASHED, dotted: BorderStyle.DOTTED, double: BorderStyle.DOUBLE }[b.style];
  const side = (on: boolean) => (on ? { style, size: Math.round(b.width * 8), color: b.color.replace("#", ""), space: b.space } : undefined);
  return {
    pageBorders: { display: PageBorderDisplay.ALL_PAGES, offsetFrom: b.from === "page" ? PageBorderOffsetFrom.PAGE : PageBorderOffsetFrom.TEXT },
    pageBorderTop: side(b.sides.top),
    pageBorderRight: side(b.sides.right),
    pageBorderBottom: side(b.sides.bottom),
    pageBorderLeft: side(b.sides.left),
  };
}

export async function exportDocx(doc: JSONContent, page: PageSetup): Promise<Uint8Array> {
  await loadImages(doc, images);
  const dim = PAGE_MM[page.size];
  const landscape = page.orientation === "landscape";
  const footerChildren: ParagraphChild[] = [new TextRun(page.footer)];
  if (page.pageNumbers) footerChildren.push(new TextRun({ children: [page.footer ? "   " : "", PageNumber.CURRENT] }));
  const d = new Document({
    creator: "Oceanic Docs",
    numbering: {
      config: [
        { reference: "bullets", levels: Array.from({ length: 9 }, (_, i) => ({ level: i, format: LevelFormat.BULLET, text: ["•", "◦", "▪"][i % 3], alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 * (i + 1), hanging: 360 } } } })) },
        { reference: "numbers", levels: Array.from({ length: 9 }, (_, i) => ({ level: i, format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][i % 3], text: `%${i + 1}.`, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 * (i + 1), hanging: 360 } } } })) },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            // docx swaps width/height itself for landscape.
            size: { width: mmToTwip(dim.w), height: mmToTwip(dim.h), orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
            margin: { top: mmToTwip(page.margin.top), right: mmToTwip(page.margin.right), bottom: mmToTwip(page.margin.bottom), left: mmToTwip(page.margin.left) },
            borders: page.border ? pageBorders(page.border) : undefined,
          },
        },
        headers: page.header ? { default: new Header({ children: [new Paragraph({ children: [new TextRun(page.header)] })] }) } : undefined,
        footers: page.footer || page.pageNumbers ? { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: footerChildren })] }) } : undefined,
        children: blocks(doc.content),
      },
    ],
  });
  return new Uint8Array(await (await Packer.toBlob(d)).arrayBuffer());
}
