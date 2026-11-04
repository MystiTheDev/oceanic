/* ---------------------------------------------------------------------------
 * Page export, Notion-style: one page → a single .md / .html file; a page
 * with its sub-pages → a .zip laid out as `Page.md` + `Page/Child.md` + …,
 * where each parent links to its children.
 * ------------------------------------------------------------------------ */
import { BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import { schema } from "../editor/schema";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { strToU8, zipSync } from "fflate";
import type { PageMeta } from "../data/workspace";
import { api } from "../data/api";
import { pdfNames } from "../pdf/PdfRef";

export type ExportFormat = "markdown" | "html";

type ExportOptions = {
  rootId: string;
  /** Live pages only; trashed sub-pages are left out. */
  pages: PageMeta[];
  format: ExportFormat;
  includeSubpages: boolean;
  loadBlocks: (pageId: string) => Promise<PartialBlock[]>;
};

export type ExportFile = { filename: string; data: Uint8Array; mime: string };

// A headless editor does the block → Markdown / HTML conversion, so pages
// that aren't open can be exported too.
// It uses Oceanic's schema so equations and page links convert too.
let converter: BlockNoteEditor<any, any, any> | null = null;
const getConverter = () => (converter ??= BlockNoteEditor.create({ schema }));

const EXT: Record<ExportFormat, string> = { markdown: "md", html: "html" };

/** Filesystem-safe name; Windows forbids \ / : * ? " < > | and trailing dots. */
const safeName = (title: string) =>
  (title || "Untitled").replace(/[\\/:*?"<>|]/g, "-").replace(/[. ]+$/, "").slice(0, 80) ||
  "Untitled";

/** Disambiguate sibling names the way file managers do: "Notes", "Notes (2)". */
function uniqueNames(pages: PageMeta[]): Map<string, string> {
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const p of pages) {
    const base = safeName(p.title);
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    out.set(p.id, n === 1 ? base : `${base} (${n})`);
  }
  return out;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const linkPath = (dir: string, name: string, ext: string) =>
  [dir, `${name}.${ext}`].map(encodeURIComponent).join("/");

/** PDF blocks and `p. N` chips export as the PDF's name: make sure the names are known. */
async function loadPdfNames(blocks: PartialBlock[]) {
  const ids = [...JSON.stringify(blocks).matchAll(/"docId":"([^"]+)"/g)].map((m) => m[1]).filter((id) => !pdfNames.has(id));
  for (const id of new Set(ids)) {
    const doc = await api.getPdfDoc(id).catch(() => null);
    if (doc) pdfNames.set(id, doc.name);
  }
}

async function renderPage(
  page: PageMeta,
  format: ExportFormat,
  children: { name: string; dir: string; page: PageMeta }[],
  loadBlocks: ExportOptions["loadBlocks"],
): Promise<string> {
  const editor = getConverter();
  const blocks = await loadBlocks(page.id);
  await loadPdfNames(blocks);
  const title = page.title || "Untitled";
  const ext = EXT[format];

  if (format === "markdown") {
    const body = editor.blocksToMarkdownLossy(blocks).trim();
    const links = children.length
      ? "\n\n---\n\n" +
        children
          .map((c) => `- [${c.page.icon} ${c.page.title || "Untitled"}](${linkPath(c.dir, c.name, ext)})`)
          .join("\n")
      : "";
    return `# ${page.icon} ${title}\n\n${body}${links}\n`;
  }

  const body = editor.blocksToHTMLLossy(blocks);
  const links = children.length
    ? `<hr><ul class="subpages">${children
        .map(
          (c) =>
            `<li><a href="${linkPath(c.dir, c.name, ext)}">${c.page.icon} ${escapeHtml(c.page.title || "Untitled")}</a></li>`,
        )
        .join("")}</ul>`
    : "";
  return htmlDocument(title, page.icon, body + links);
}

/** Self-contained page with Notion-like reading styles (light, system fonts). */
function htmlDocument(title: string, icon: string, body: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #fff; color: #37352f;
    font: 16px/1.6 ui-sans-serif, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
  main { max-width: 720px; margin: 0 auto; padding: 64px 24px 96px; }
  .icon { font-size: 64px; line-height: 1; margin-bottom: 8px; }
  h1.title { font-size: 40px; line-height: 1.2; margin: 0 0 24px; }
  h1, h2, h3 { line-height: 1.3; margin: 1.6em 0 0.4em; }
  p { margin: 0.4em 0; }
  a { color: inherit; text-decoration-color: rgba(55,53,47,.4); text-underline-offset: 3px; }
  blockquote { margin: 0.6em 0; padding-left: 14px; border-left: 3px solid currentColor; }
  code { background: rgba(135,131,120,.15); color: #eb5757; border-radius: 4px; padding: 0.15em 0.35em;
    font: 85% ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  pre { background: #f7f6f3; border-radius: 6px; padding: 16px; overflow-x: auto; }
  pre code { background: none; color: inherit; padding: 0; }
  hr { border: 0; border-top: 1px solid rgba(55,53,47,.16); margin: 2em 0; }
  img { max-width: 100%; border-radius: 4px; }
  table { border-collapse: collapse; } td, th { border: 1px solid rgba(55,53,47,.16); padding: 6px 10px; }
  ul.subpages { list-style: none; padding: 0; } ul.subpages li { margin: 4px 0; }
</style>
</head>
<body>
<main>
<div class="icon">${icon}</div>
<h1 class="title">${escapeHtml(title)}</h1>
${body}
</main>
</body>
</html>
`;
}

export async function buildExport(opts: ExportOptions): Promise<ExportFile> {
  const { rootId, pages, format, includeSubpages, loadBlocks } = opts;
  const root = pages.find((p) => p.id === rootId);
  if (!root) throw new Error("Page not found");
  const ext = EXT[format];
  const rootName = safeName(root.title);
  const childrenOf = (id: string) => pages.filter((p) => p.parentId === id);

  if (!includeSubpages || childrenOf(root.id).length === 0) {
    const text = await renderPage(root, format, [], loadBlocks);
    return {
      filename: `${rootName}.${ext}`,
      data: strToU8(text),
      mime: format === "markdown" ? "text/markdown" : "text/html",
    };
  }

  // Each page sits beside a folder of the same name that holds its children.
  const files: Record<string, Uint8Array> = {};
  const walk = async (page: PageMeta, name: string, folder: string) => {
    const kids = childrenOf(page.id);
    const names = uniqueNames(kids);
    const children = kids.map((k) => ({ page: k, name: names.get(k.id)!, dir: name }));
    files[`${folder}${name}.${ext}`] = strToU8(await renderPage(page, format, children, loadBlocks));
    for (const c of children) await walk(c.page, c.name, `${folder}${name}/`);
  };
  await walk(root, rootName, "");

  return { filename: `${rootName}.zip`, data: zipSync(files), mime: "application/zip" };
}

/** The file name an export will get, known before anything is rendered. */
export function exportFilename(opts: Pick<ExportOptions, "rootId" | "pages" | "format" | "includeSubpages">) {
  const root = opts.pages.find((p) => p.id === opts.rootId);
  const zipped = opts.includeSubpages && opts.pages.some((p) => p.parentId === opts.rootId);
  return `${safeName(root?.title ?? "")}.${zipped ? "zip" : EXT[opts.format]}`;
}

const bytesToBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Where the user chose to save: `label` is shown back to them afterwards. */
export type SaveTarget = { label: string; write: (data: Uint8Array) => Promise<void> };

const MIME: Record<string, string> = {
  md: "text/markdown",
  html: "text/html",
  zip: "application/zip",
  pdf: "application/pdf",
};

type SaveFilePicker = (opts: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ name: string; createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }> }>;

/**
 * Asks where to save `filename`; resolves null if the user cancels.
 * Call this straight from the click: browsers only open the picker while the
 * click's user activation is still fresh, so render the export afterwards.
 *
 * Desktop: native Save dialog, then Rust writes the bytes. Browser: the
 * File System Access save picker where available, else a plain download.
 */
export async function pickSaveTarget(filename: string): Promise<SaveTarget | null> {
  const ext = filename.split(".").pop()!;
  const mime = MIME[ext] ?? "application/octet-stream";

  if (isTauri()) {
    const path = await save({
      defaultPath: filename,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (!path) return null;
    return {
      label: path,
      // PDFs can be large: base64 is ~4x smaller over IPC than a number array.
      write: (data) =>
        ext === "pdf" ? invoke("docs_write", { path, data: bytesToBase64(data) }) : invoke("write_export_file", { path, data: Array.from(data) }),
    };
  }

  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [{ description: ext.toUpperCase(), accept: { [mime]: [`.${ext}`] } }],
      });
      return {
        label: handle.name,
        write: async (data) => {
          const out = await handle.createWritable();
          await out.write(new Blob([data as BlobPart], { type: mime }));
          await out.close();
        },
      };
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
      // Picker unavailable here (e.g. sandboxed frame): fall through to a download.
    }
  }

  return {
    label: `Downloads/${filename}`,
    write: async (data) => {
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
      const a = Object.assign(document.createElement("a"), { href: url, download: filename });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
}

/* --------------------------------------------------------------------- PDF */
export type PaperSize = "A4" | "Letter";

/**
 * PDF via the system print dialog ("Save as PDF" / "Microsoft Print to PDF"):
 * assignment-ready layout with 2 cm margins, the title and date in the page
 * header and "Page N of M" in the footer (CSS page-margin boxes).
 */
export async function printPage(
  page: PageMeta,
  loadBlocks: ExportOptions["loadBlocks"],
  paper: PaperSize,
): Promise<void> {
  const blocks = await loadBlocks(page.id);
  const title = page.title || "Untitled";
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const q = (s: string) => JSON.stringify(s);
  const css = `
  @page {
    size: ${paper};
    margin: 20mm 20mm 22mm;
    @top-left { content: ${q(title)}; font: 9pt Inter, "Segoe UI", sans-serif; color: #91918e; }
    @top-right { content: ${q(date)}; font: 9pt Inter, "Segoe UI", sans-serif; color: #91918e; }
    @bottom-center { content: "Page " counter(page) " of " counter(pages); font: 9pt Inter, "Segoe UI", sans-serif; color: #91918e; }
  }
  body { font-size: 11.5pt; }
  main { max-width: none; padding: 0; }
  .icon { font-size: 40px; }
  h1.title { font-size: 26pt; }
  h1, h2, h3 { break-after: avoid; }
  pre, blockquote, table, img, li { break-inside: avoid; }
  a { text-decoration: none; }`;
  const html = htmlDocument(title, page.icon, getConverter().blocksToHTMLLossy(blocks)).replace(
    "</style>",
    `${css}\n</style>`,
  );

  const frame = Object.assign(document.createElement("iframe"), { title: "print" });
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  await new Promise((r) => setTimeout(r, 150)); // let fonts and images settle
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  window.setTimeout(() => frame.remove(), 1000);
}
