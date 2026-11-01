import type JSZip from "jszip";
import type { JSONContent } from "@tiptap/core";
import { DEFAULT_PAGE, type PageSetup } from "./docxIO";

/**
 * Reads Word's own XML (document, styles, numbering, relationships, header/footer)
 * into editor JSON: fonts, sizes, colours, highlight, alignment, line spacing,
 * headings, lists, tables, images, links, page breaks and page setup.
 */
type El = Element;
type RunStyle = { b?: boolean; i?: boolean; u?: boolean; strike?: boolean; color?: string; size?: number; font?: string; highlight?: string };
type ParaStyle = {
  align?: string; line?: number; heading?: number; run: RunStyle; basedOn?: string; numId?: string; ilvl?: number;
  /** Points: space before/after, indents (first < 0 = hanging). */
  before?: number; after?: number; indLeft?: number; indRight?: number; indFirst?: number;
  /** First custom tab stop (pt from the indent). */
  tab?: number;
};
const twipPt = (v?: string) => (v == null ? undefined : Number(v) / 20);

const kids = (el: El | null | undefined, name?: string) => (el ? ([...el.childNodes].filter((n) => n.nodeType === 1 && (!name || n.nodeName === name)) as El[]) : []);
const kid = (el: El | null | undefined, name: string) => kids(el, name)[0];
const val = (el: El | undefined, attr = "w:val") => el?.getAttribute(attr) ?? undefined;
const on = (el: El | undefined) => !!el && !["0", "false", "none"].includes(val(el) ?? "true");
const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");
const HIGHLIGHT: Record<string, string> = {
  yellow: "#ffff00", green: "#00ff00", cyan: "#00ffff", magenta: "#ff00ff", blue: "#0000ff", red: "#ff0000", darkBlue: "#000080",
  darkCyan: "#008080", darkGreen: "#008000", darkMagenta: "#800080", darkRed: "#800000", darkYellow: "#808000", darkGray: "#808080", lightGray: "#c0c0c0", black: "#000000",
};
const ALIGN: Record<string, string> = { left: "left", start: "left", center: "center", right: "right", end: "right", both: "justify", distribute: "justify" };
const twipToMm = (t: number) => Math.round((t / 1440) * 25.4 * 10) / 10;

function readRunProps(rPr: El | undefined): RunStyle {
  if (!rPr) return {};
  const r: RunStyle = {};
  const b = kid(rPr, "w:b"), i = kid(rPr, "w:i"), u = kid(rPr, "w:u"), s = kid(rPr, "w:strike");
  if (b) r.b = on(b);
  if (i) r.i = on(i);
  if (u) r.u = on(u);
  if (s) r.strike = on(s);
  const color = val(kid(rPr, "w:color"));
  if (color && color !== "auto") r.color = "#" + color;
  const sz = val(kid(rPr, "w:sz"));
  if (sz) r.size = Number(sz) / 2;
  const fonts = kid(rPr, "w:rFonts");
  const font = fonts && (val(fonts, "w:ascii") ?? val(fonts, "w:hAnsi"));
  if (font) r.font = font;
  const hl = val(kid(rPr, "w:highlight"));
  const shd = val(kid(rPr, "w:shd"), "w:fill");
  if (hl && hl !== "none") r.highlight = HIGHLIGHT[hl] ?? "#ffff00";
  else if (shd && shd !== "auto" && shd !== "FFFFFF") r.highlight = "#" + shd;
  return r;
}

function readParaProps(pPr: El | undefined): Omit<ParaStyle, "run"> {
  if (!pPr) return {};
  const p: Omit<ParaStyle, "run"> = {};
  const jc = val(kid(pPr, "w:jc"));
  if (jc) p.align = ALIGN[jc];
  const sp = kid(pPr, "w:spacing");
  if (sp && val(sp, "w:line") && (val(sp, "w:lineRule") ?? "auto") === "auto") p.line = Number(val(sp, "w:line")) / 240;
  if (sp) {
    p.before = twipPt(val(sp, "w:before"));
    p.after = twipPt(val(sp, "w:after"));
  }
  const ind = kid(pPr, "w:ind");
  if (ind) {
    p.indLeft = twipPt(val(ind, "w:left") ?? val(ind, "w:start"));
    p.indRight = twipPt(val(ind, "w:right") ?? val(ind, "w:end"));
    const hanging = twipPt(val(ind, "w:hanging"));
    p.indFirst = hanging != null ? -hanging : twipPt(val(ind, "w:firstLine"));
  }
  const stop = kids(kid(pPr, "w:tabs"), "w:tab").find((t) => val(t) !== "clear");
  if (stop) p.tab = twipPt(val(stop, "w:pos"));
  const outline = val(kid(pPr, "w:outlineLvl"));
  if (outline != null) p.heading = Math.min(Number(outline) + 2, 4);
  const num = kid(pPr, "w:numPr");
  if (num) {
    p.numId = val(kid(num, "w:numId"));
    p.ilvl = Number(val(kid(num, "w:ilvl")) ?? 0);
  }
  return p;
}

/** Styles resolved through basedOn, with document defaults underneath. */
function readStyles(xml?: string) {
  const styles = new Map<string, ParaStyle>();
  let defaults: RunStyle = {};
  let defaultPara = "Normal";
  if (!xml) return { resolve: (_?: string): ParaStyle => ({ run: defaults }), defaultPara };
  const doc = parse(xml);
  defaults = readRunProps(kid(kid(kid(doc.documentElement, "w:docDefaults"), "w:rPrDefault"), "w:rPr"));
  const paraDefaults = strip(readParaProps(kid(kid(kid(doc.documentElement, "w:docDefaults"), "w:pPrDefault"), "w:pPr")));
  for (const s of kids(doc.documentElement, "w:style")) {
    const id = val(s, "w:styleId")!;
    const name = (val(kid(s, "w:name")) ?? "").toLowerCase();
    const p: ParaStyle = { ...readParaProps(kid(s, "w:pPr")), run: readRunProps(kid(s, "w:rPr")), basedOn: val(kid(s, "w:basedOn")) };
    // Title → level 1, Heading 1–3 → levels 2–4 (our style list: Title, H1, H2, H3).
    if (name === "title") p.heading = 1;
    const m = name.match(/^heading (\d)$/);
    if (m) p.heading = Math.min(Number(m[1]) + 1, 4);
    styles.set(id, p);
    if (s.getAttribute("w:type") === "paragraph" && s.getAttribute("w:default") === "1") defaultPara = id;
  }
  const cache = new Map<string, ParaStyle>();
  const resolve = (id?: string, depth = 0): ParaStyle => {
    const key = id ?? defaultPara;
    if (cache.has(key)) return cache.get(key)!;
    const s = styles.get(key);
    if (!s || depth > 10) return { ...paraDefaults, run: defaults };
    const base = s.basedOn ? resolve(s.basedOn, depth + 1) : { ...paraDefaults, run: defaults };
    const out: ParaStyle = { ...base, ...strip(s), run: { ...base.run, ...s.run } };
    cache.set(key, out);
    return out;
  };
  return { resolve, defaultPara };
}
const strip = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([k, v]) => v !== undefined && k !== "run" && k !== "basedOn")) as Partial<T>;

/** numId → whether each level is a bullet. */
function readNumbering(xml?: string) {
  const bullet = new Map<string, boolean[]>();
  if (!xml) return bullet;
  const doc = parse(xml);
  const abstract = new Map<string, boolean[]>();
  for (const a of kids(doc.documentElement, "w:abstractNum"))
    abstract.set(val(a, "w:abstractNumId")!, kids(a, "w:lvl").map((l) => val(kid(l, "w:numFmt")) === "bullet"));
  for (const n of kids(doc.documentElement, "w:num")) bullet.set(val(n, "w:numId")!, abstract.get(val(kid(n, "w:abstractNumId"))!) ?? []);
  return bullet;
}

function relsOf(xml?: string) {
  const map = new Map<string, string>();
  if (!xml) return map;
  for (const r of [...parse(xml).getElementsByTagName("Relationship")]) map.set(r.getAttribute("Id")!, r.getAttribute("Target")!);
  return map;
}

export async function readDocx(zip: JSZip): Promise<{ content: JSONContent; page: PageSetup; lossy: boolean }> {
  const text = (p: string) => zip.file(p)?.async("string");
  const [docXml, stylesXml, numXml, relsXml] = await Promise.all([text("word/document.xml"), text("word/styles.xml"), text("word/numbering.xml"), text("word/_rels/document.xml.rels")]);
  const settingsXml = await text("word/settings.xml");
  const defaultTab = Number(settingsXml?.match(/<w:defaultTabStop w:val="(\d+)"/)?.[1] ?? 720) / 20;
  const doc = parse(docXml ?? "<w:document/>");
  const body = kid(doc.documentElement, "w:body");
  const { resolve } = readStyles(stylesXml);
  const numbering = readNumbering(numXml);
  const rels = relsOf(relsXml);
  const lossy = /<w:(txbxContent|ins|del|commentReference)\b/.test(docXml ?? "");

  // Text column width (EMU) for placing offset-positioned pictures.
  const sect0 = kid(body, "w:sectPr");
  const twip = (el: El | undefined, n: string) => Number(val(el, n) ?? 0);
  const leftEmu = twip(kid(sect0, "w:pgMar"), "w:left") * 635;
  const contentEmu = (twip(kid(sect0, "w:pgSz"), "w:w") - twip(kid(sect0, "w:pgMar"), "w:left") - twip(kid(sect0, "w:pgMar"), "w:right")) * 635;
  const image = async (host: El | undefined, pAlign?: string): Promise<JSONContent | null> => {
    // host is the w:drawing / w:pict element the image lives in.
    const blip = (host?.getElementsByTagName("a:blip")[0] as El) ?? (host?.getElementsByTagName("v:imagedata")[0] as El);
    const target = blip && rels.get(blip.getAttribute("r:embed") ?? "");
    const file = target && zip.file("word/" + target.replace(/^\/?word\//, ""));
    if (!file) return null;
    const ext = target!.split(".").pop()!.toLowerCase().replace("jpg", "jpeg");
    const attrs: Record<string, unknown> = { src: `data:image/${ext};base64,${await file.async("base64")}` };
    // True display size: wp:extent carries EMU coordinates (9525 EMU = 1 px).
    const inline = kid(host, "wp:inline") ?? kid(host, "wp:anchor");
    const extent = inline && kid(inline, "wp:extent");
    if (extent) {
      const cx = parseInt(extent.getAttribute("cx") ?? "", 10);
      if (Number.isFinite(cx)) attrs.width = Math.max(8, Math.round(cx / 9525));
    }
    // Alignment: for floating images use Word's horizontal position, else the
    // paragraph's alignment (a centered paragraph centers its pictures).
    if (inline?.nodeName === "wp:anchor" && (kid(inline, "wp:wrapSquare") || kid(inline, "wp:wrapTight") || kid(inline, "wp:wrapThrough"))) {
      // Text wraps beside it: float to the side Word puts it on.
      const posH = kid(inline, "wp:positionH");
      const align = posH ? val(kid(posH, "wp:align")) : undefined;
      const offset = Number(kid(posH, "wp:posOffset")?.textContent ?? 0) / 9525;
      attrs.float = align === "right" || align === "outside" || (!align && offset > 300) ? "right" : "left";
    } else if (inline?.nodeName === "wp:anchor") {
      const posH = kid(inline, "wp:positionH");
      const a = posH ? val(kid(posH, "wp:align")) : undefined;
      let anchorAlign = a ? ALIGN[a] : undefined;
      // Placed by an exact offset (no alignment): pick the side its centre is nearest.
      const off = kid(posH, "wp:posOffset")?.textContent;
      if (!a && off != null && contentEmu > 0) {
        const fromPage = val(posH, "relativeFrom") === "page";
        const cx = Number(extent?.getAttribute("cx") ?? 0);
        const centre = Number(off) - (fromPage ? leftEmu : 0) + cx / 2;
        anchorAlign = Math.abs(centre - contentEmu / 2) < contentEmu * 0.15 ? "center" : centre > contentEmu / 2 ? "right" : "left";
      }
      if (anchorAlign && anchorAlign !== "left") attrs.textAlign = anchorAlign;
      else if (pAlign && pAlign !== "left") attrs.textAlign = pAlign;
    } else if (pAlign && pAlign !== "left") attrs.textAlign = pAlign;
    return { type: "image", attrs };
  };

  const runsOf = async (p: El, base: RunStyle, out: JSONContent[], blocks: JSONContent[], link?: string, imgAlign?: string) => {
    for (const r of kids(p)) {
      if (r.nodeName === "w:hyperlink") {
        await runsOf(r, base, out, blocks, rels.get(r.getAttribute("r:id") ?? "") ?? r.getAttribute("w:anchor") ?? undefined, imgAlign);
        continue;
      }
      if (r.nodeName === "w:ins" || r.nodeName === "w:smartTag" || r.nodeName === "w:sdt" || r.nodeName === "w:sdtContent") {
        await runsOf(r, base, out, blocks, link, imgAlign);
        continue;
      }
      if (r.nodeName === "m:oMath" || r.nodeName === "m:oMathPara") {
        const text = [...r.getElementsByTagName("m:t")].map((t) => t.textContent).join("");
        if (text) out.push({ type: "text", text, marks: [{ type: "italic" }, { type: "textStyle", attrs: { fontFamily: "Cambria Math" } }] });
        continue;
      }
      if (r.nodeName !== "w:r") continue;
      const rPr = kid(r, "w:rPr");
      const st = { ...base, ...resolve(val(kid(rPr, "w:rStyle"))).run, ...readRunProps(rPr) };
      const marks: JSONContent["marks"] = [];
      if (st.b) marks.push({ type: "bold" });
      if (st.i) marks.push({ type: "italic" });
      if (st.u) marks.push({ type: "underline" });
      if (st.strike) marks.push({ type: "strike" });
      if (st.highlight) marks.push({ type: "highlight", attrs: { color: st.highlight } });
      if (link) marks.push({ type: "link", attrs: { href: link } });
      const ts: Record<string, string> = {};
      if (st.color) ts.color = st.color;
      if (st.size) ts.fontSize = `${st.size}pt`;
      if (st.font) ts.fontFamily = st.font;
      if (Object.keys(ts).length) marks.push({ type: "textStyle", attrs: ts });
      for (const c of kids(r)) {
        if (c.nodeName === "w:t") c.textContent && out.push({ type: "text", text: c.textContent, marks: marks.length ? marks : undefined });
        else if (c.nodeName === "w:tab") out.push({ type: "text", text: "\t", marks: marks.length ? marks : undefined });
        else if (c.nodeName === "w:cr") out.push({ type: "hardBreak" });
        else if (c.nodeName === "w:br") c.getAttribute("w:type") === "page" ? blocks.push({ type: "pageBreak" }) : out.push({ type: "hardBreak" });
        else if (c.nodeName === "w:drawing" || c.nodeName === "w:pict") {
          const img = await image(c, imgAlign);
          // Inline (Word model): the image stays in the flowing line with any
          // text/space runs, so padding-space positioning survives import.
          if (img) out.push(img);
        }
      }
    }
  };

  const paragraph = async (p: El): Promise<{ node: JSONContent; extra: JSONContent[]; list?: { bullet: boolean; level: number } }> => {
    const pPr = kid(p, "w:pPr");
    const style = resolve(val(kid(pPr, "w:pStyle")));
    const own = readParaProps(pPr);
    const ps = { ...style, ...strip(own) };
    const content: JSONContent[] = [];
    const extra: JSONContent[] = [];
    // Paragraph mark formatting doesn't apply to runs; only the style's run props do.
    await runsOf(p, style.run, content, extra, undefined, ps.align);
    const attrs: Record<string, unknown> = {};
    if (ps.align && ps.align !== "left") attrs.textAlign = ps.align;
    // A paragraph holding just a placed picture takes the picture's alignment.
    const visible = content.filter((n) => !(n.type === "text" && !n.text?.trim()));
    if (visible.length === 1 && visible[0].type === "image" && visible[0].attrs?.textAlign) attrs.textAlign = visible[0].attrs.textAlign;
    if (ps.line && Math.abs(ps.line - 1) > 0.01) attrs.lineHeight = String(Math.round(ps.line * 100) / 100);
    // Word's own spacing/indents (pt), so text and pictures sit where Word puts them.
    if (ps.before != null) attrs.spaceBefore = ps.before;
    if (ps.after != null) attrs.spaceAfter = ps.after;
    if (ps.indLeft) attrs.indentLeft = ps.indLeft;
    if (ps.indRight) attrs.indentRight = ps.indRight;
    if (ps.indFirst) attrs.indentFirst = ps.indFirst;
    // Tabs jump to Word's tab stop (or its default stop interval).
    attrs.tabStop = ps.tab ? Math.max(6, ps.tab - (ps.indLeft ?? 0)) : defaultTab;
    const node: JSONContent = ps.heading
      ? { type: "heading", attrs: { level: ps.heading, ...attrs }, content: content.length ? content : undefined }
      : { type: "paragraph", attrs, content: content.length ? content : undefined };
    const list = ps.numId && ps.numId !== "0" ? { bullet: numbering.get(ps.numId)?.[ps.ilvl ?? 0] ?? true, level: ps.ilvl ?? 0 } : undefined;
    return { node, extra, list };
  };

  const table = async (t: El): Promise<JSONContent> => {
    // Column widths from <w:tblGrid> (twips → px); cells spanning columns sum them.
    const grid = kids(kid(t, "w:tblGrid"), "w:gridCol").map((g) => Math.round(Number(val(g, "w:w") ?? 0) / 15));
    return {
      type: "table",
      content: await Promise.all(
        kids(t, "w:tr").map(async (tr) => {
          let col = 0;
          return {
            type: "tableRow",
            content: await Promise.all(
              kids(tr, "w:tc").map(async (tc) => {
                const span = Number(val(kid(kid(tc, "w:tcPr"), "w:gridSpan")) ?? 1);
                const widths = grid.slice(col, col + span);
                col += span;
                const inner = await blocksOf(tc);
                const attrs: Record<string, unknown> = {};
                if (span > 1) attrs.colspan = span;
                if (widths.length === span && widths.every((x) => x > 0)) attrs.colwidth = widths;
                return { type: "tableCell", attrs, content: inner.length ? inner : [{ type: "paragraph" }] };
              }),
            ),
          };
        }),
      ),
    };
  };

  /** Body (or cell) children → blocks, grouping list paragraphs into nested lists. */
  async function blocksOf(parent: El): Promise<JSONContent[]> {
    const out: JSONContent[] = [];
    let stack: { list: JSONContent; bullet: boolean }[] = [];
    for (const el of kids(parent)) {
      if (el.nodeName === "w:p") {
        const { node, extra, list } = await paragraph(el);
        if (list) {
          const item: JSONContent = { type: "listItem", content: [node.type === "heading" ? { ...node, type: "paragraph" } : node] };
          while (stack.length > list.level + 1 || (stack.length === list.level + 1 && stack[list.level].bullet !== list.bullet)) stack.pop();
          while (stack.length < list.level + 1) {
            const l: JSONContent = { type: list.bullet ? "bulletList" : "orderedList", content: [] };
            const parentItem = stack.length ? stack[stack.length - 1].list.content!.at(-1) : null;
            if (parentItem) parentItem.content!.push(l);
            else out.push(l);
            stack.push({ list: l, bullet: list.bullet });
          }
          stack[list.level].list.content!.push(item);
        } else {
          stack = [];
          out.push(node);
        }
        out.push(...extra);
      } else {
        stack = [];
        if (el.nodeName === "w:tbl") out.push(await table(el));
        else if (el.nodeName === "w:sdt") out.push(...(await blocksOf(kid(el, "w:sdtContent"))));
      }
    }
    return out;
  }

  const content = await blocksOf(body);

  // ---- Page setup, header and footer text.
  const page: PageSetup = { ...DEFAULT_PAGE, margin: { ...DEFAULT_PAGE.margin } };
  const sect = kid(body, "w:sectPr");
  const sz = kid(sect, "w:pgSz");
  if (sz) {
    const w = Number(val(sz, "w:w")), h = Number(val(sz, "w:h"));
    page.orientation = val(sz, "w:orient") === "landscape" || w > h ? "landscape" : "portrait";
    page.size = Math.abs(Math.min(w, h) - 12240) < 200 ? "Letter" : "A4";
  }
  const mar = kid(sect, "w:pgMar");
  if (mar) page.margin = { top: twipToMm(Number(val(mar, "w:top"))), right: twipToMm(Number(val(mar, "w:right"))), bottom: twipToMm(Number(val(mar, "w:bottom"))), left: twipToMm(Number(val(mar, "w:left"))) };
  const partText = async (ref: El | undefined) => {
    const target = ref && rels.get(ref.getAttribute("r:id") ?? "");
    const xml = target && (await text("word/" + target));
    if (!xml) return { text: "", pageNum: false };
    return { text: [...parse(xml).getElementsByTagName("w:t")].map((t) => t.textContent).join("").trim(), pageNum: /PAGE/.test(xml) };
  };
  const pick = (name: string) => kids(sect, name).find((r) => val(r, "w:type") === "default") ?? kid(sect, name);
  const header = await partText(pick("w:headerReference"));
  const footer = await partText(pick("w:footerReference"));
  page.header = header.text;
  page.footer = footer.text.replace(/^\d+$/, "");
  page.pageNumbers = footer.pageNum || header.pageNum;

  // Page borders (<w:pgBorders>): sizes are eighths of a point, space is points.
  const pb = kid(sect, "w:pgBorders");
  const sides = (["top", "right", "bottom", "left"] as const).map((s) => kid(pb, `w:${s}`));
  const first = sides.find((s) => s && val(s) && val(s) !== "nil" && val(s) !== "none");
  if (first) {
    const v = val(first)!;
    const color = val(first, "w:color");
    page.border = {
      style: v.includes("double") ? "double" : v.includes("dash") ? "dashed" : v.includes("dot") ? "dotted" : "single",
      width: Number(val(first, "w:sz") ?? 4) / 8,
      color: color && color !== "auto" ? "#" + color : "#000000",
      sides: { top: !!sides[0], right: !!sides[1], bottom: !!sides[2], left: !!sides[3] },
      from: val(pb, "w:offsetFrom") === "page" ? "page" : "text",
      space: Number(val(first, "w:space") ?? 24),
    };
  }

  return { content: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] }, page, lossy };
}
