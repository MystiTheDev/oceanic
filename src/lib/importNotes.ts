import { readOceanFile, type OceanPage } from "./oceanFile";
import JSZip from "jszip";
import mammoth from "mammoth";
import { BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import { open } from "./dialog";
import { readFileBytes } from "./fileIO";
import { schema } from "../editor/schema";
import { uploadFile } from "../editor/audio";
import { assertClean, isMalwareError } from "./malware";

/**
 * Import notes: Markdown, plain text, HTML, Word (.docx) and Notion export
 * zips. Each file becomes a page; a Notion export keeps its page tree.
 */
export type ImportedPage = { title: string; blocks: PartialBlock[]; children: ImportedPage[]; icon?: string; props?: { dueDate: string | null; status: string | null; tags: string[] }; banner?: import("./banners").Banner | null; tagColors?: Record<string, string> };
export type InFile = { name: string; bytes: Uint8Array };

let parser: BlockNoteEditor | null = null;
const editor = () => (parser ??= BlockNoteEditor.create({ schema } as never) as unknown as BlockNoteEditor);
const ext = (n: string) => n.split(".").pop()!.toLowerCase();
/** "Biology 1f2e…(32 hex).md" → "Biology" (Notion adds ids to names). */
const cleanTitle = (n: string) => n.replace(/\.(md|markdown|txt|html?|docx)$/i, "").replace(/\s[0-9a-f]{32}$/i, "").trim() || "Untitled";

async function toBlocks(name: string, bytes: Uint8Array, rewriteMd?: (md: string) => Promise<string>): Promise<PartialBlock[]> {
  const text = () => new TextDecoder().decode(bytes);
  switch (ext(name)) {
    case "md":
    case "markdown": {
      let md = text().replace(/^﻿?\s*# .*\r?\n+/, ""); // the first heading is the page title
      if (rewriteMd) md = await rewriteMd(md);
      return editor().tryParseMarkdownToBlocks(md);
    }
    case "html":
    case "htm": {
      // Oceanic's own HTML export repeats the icon and title above the body: drop them.
      const doc = new DOMParser().parseFromString(text(), "text/html");
      doc.querySelectorAll("style, script, .icon, h1.title").forEach((el) => el.remove());
      return editor().tryParseHTMLToBlocks((doc.querySelector("main") ?? doc.body).innerHTML);
    }
    case "docx": {
      const { value } = await mammoth.convertToHtml({ arrayBuffer: bytes.slice().buffer as ArrayBuffer });
      return editor().tryParseHTMLToBlocks(value);
    }
    default:
      return text()
        .split(/\r?\n/)
        .map((line) => ({ type: "paragraph", content: line }) as PartialBlock);
  }
}

/* Zip bombs: limits on nesting, entries and unpacked size (checked from the zip's own
 * headers before unpacking, and again on the bytes actually unpacked). */
const ZIP_MAX_DEPTH = 2; // Notion's export-inside-an-export, and no deeper
const ZIP_MAX_ENTRIES = 5000;
const ZIP_MAX_FILE = 100 * 1024 * 1024;
const ZIP_MAX_TOTAL = 500 * 1024 * 1024;
type ZipBudget = { left: number };
const declaredSize = (f: JSZip.JSZipObject) => (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
async function unpack(f: JSZip.JSZipObject, budget: ZipBudget): Promise<Uint8Array> {
  const check = (n: number) => {
    if (n > ZIP_MAX_FILE) throw new Error(`this zip has a file larger than 100 MB (${f.name})`);
    if (n > budget.left) throw new Error("this zip unpacks to more than Oceanic will import (500 MB)");
  };
  check(declaredSize(f));
  const bytes = await f.async("uint8array");
  check(bytes.length);
  budget.left -= bytes.length;
  return bytes;
}

/** Every file in the zip (and in zips inside it) goes to the antivirus, not only the notes:
 *  one flagged file anywhere stops the whole import. Its own budget, since the import unpacks again. */
async function scanZip(zip: JSZip, depth: number, budget: ZipBudget) {
  for (const f of Object.values(zip.files)) {
    if (f.dir) continue;
    const bytes = await unpack(f, budget);
    await assertClean(f.name, bytes, true); // the zip as a whole had the full file scan
    if (f.name.toLowerCase().endsWith(".zip") && depth < ZIP_MAX_DEPTH) {
      const inner = await JSZip.loadAsync(bytes).catch(() => null);
      if (inner && Object.keys(inner.files).length <= ZIP_MAX_ENTRIES) await scanZip(inner, depth + 1, budget);
    }
  }
}

/** A Notion export: folders hold a page's subpages; images are copied into Oceanic. */
async function fromZip(bytes: Uint8Array, depth = 1, budget: ZipBudget = { left: ZIP_MAX_TOTAL }): Promise<ImportedPage[]> {
  if (depth > ZIP_MAX_DEPTH) throw new Error("this zip has too many zips inside it");
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files);
  if (entries.length > ZIP_MAX_ENTRIES) throw new Error(`this zip has more than ${ZIP_MAX_ENTRIES} files`);
  if (entries.reduce((s, f) => s + declaredSize(f), 0) > budget.left) throw new Error("this zip unpacks to more than Oceanic will import (500 MB)");
  if (depth === 1) await scanZip(zip, 1, { left: ZIP_MAX_TOTAL });
  // Notion sometimes nests the real export zip inside the outer one.
  const inner = entries.filter((f) => !f.dir && f.name.toLowerCase().endsWith(".zip"));
  if (inner.length && !Object.keys(zip.files).some((n) => /\.(md|html?)$/i.test(n))) {
    const out: ImportedPage[] = [];
    for (const f of inner) out.push(...(await fromZip(await unpack(f, budget), depth + 1, budget))); // one at a time: the budget is shared
    return out;
  }
  const notes = Object.values(zip.files).filter((f) => !f.dir && /\.(md|markdown|html?|txt)$/i.test(f.name));
  const byPath = new Map<string, ImportedPage>();
  const roots: ImportedPage[] = [];
  // Parents first: shorter paths before longer ones.
  notes.sort((a, b) => a.name.split("/").length - b.name.split("/").length);
  for (const f of notes) {
    const dir = f.name.includes("/") ? f.name.slice(0, f.name.lastIndexOf("/")) : "";
    const rewrite = async (md: string) => {
      // Relative image links → files copied into Oceanic's assets.
      const found = [...md.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)];
      for (const m of found) {
        const rel = decodeURIComponent(m[1]);
        if (/^https?:|^data:/.test(rel)) continue;
        const path = (dir ? dir + "/" : "") + rel;
        const img = zip.file(path) ?? zip.file(rel);
        if (!img) continue;
        const url = await uploadFile(new File([(await unpack(img, budget)) as BlobPart], rel.split("/").pop()!)).catch(() => null);
        if (url) md = md.split(m[1]).join(url);
      }
      return md;
    };
    const page: ImportedPage = { title: cleanTitle(f.name.split("/").pop()!), blocks: await toBlocks(f.name, await unpack(f, budget), rewrite), children: [] };
    byPath.set(f.name.replace(/\.(md|markdown|html?|txt)$/i, ""), page);
    const parent = byPath.get(dir);
    if (parent) parent.children.push(page);
    else roots.push(page);
  }
  return roots;
}

/* Imported files come from anyone. Before they become pages:
 *  - remote media (images, video, audio, files on a web server) are not kept, because loading them
 *    tells that server you opened the note; a line names what was left out;
 *  - links that aren't web, mail or phone links (javascript:, data:, file:…) become plain text. */
/** Remote or unsafe media URL. The app's own assets (asset: / asset.localhost, where imported files are copied) are fine. */
const isRemoteMedia = (url: string) =>
  /^(https?|ftp|file|javascript|vbscript):|^\/\//i.test(url) && !/^(asset:\/\/localhost\/|https?:\/\/asset\.localhost\/)/i.test(url);
const SAFE_LINK = /^(https?:|mailto:|tel:|#)/i;
type Node = { type?: string; props?: Record<string, unknown>; content?: unknown; children?: Node[]; href?: string; text?: string };

function cleanInline(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return (content as Node[]).flatMap((c) => (c.type === "link" && typeof c.href === "string" && !SAFE_LINK.test(c.href.trim()) ? ((c.content as Node[]) ?? []) : [c]));
}

function cleanBlocks(blocks: PartialBlock[]): PartialBlock[] {
  return (blocks as Node[]).map((b) => {
    const url = typeof b.props?.url === "string" ? b.props.url.trim() : "";
    if (url && isRemoteMedia(url)) {
      let host = "the web";
      try {
        host = new URL(url).host || host;
      } catch {
        /* not a URL */
      }
      const what = b.type === "image" ? "Image" : b.type === "video" ? "Video" : b.type === "audio" ? "Audio" : "File";
      return { type: "paragraph", content: `[${what} from ${host} not loaded: imported notes don't fetch files from the internet]`, children: cleanBlocks((b.children ?? []) as PartialBlock[]) } as PartialBlock;
    }
    const content = b.type === "table" && b.content && typeof b.content === "object"
      ? { ...(b.content as object), rows: ((b.content as { rows?: { cells: unknown[] }[] }).rows ?? []).map((r) => ({ ...r, cells: r.cells.map((c) => (Array.isArray(c) ? cleanInline(c) : { ...(c as object), content: cleanInline((c as Node).content) })) })) }
      : cleanInline(b.content);
    return { ...b, content, children: cleanBlocks((b.children ?? []) as PartialBlock[]) } as PartialBlock;
  });
}

const cleanPage = (p: ImportedPage): ImportedPage => ({
  ...p,
  blocks: cleanBlocks(p.blocks),
  banner: p.banner && !p.banner.src.startsWith("css:") && isRemoteMedia(p.banner.src.trim()) ? null : p.banner,
  children: p.children.map(cleanPage),
});

/** Why a file didn't import, in words for the summary. */
export type ImportFailure = { name: string; reason: string };
const reasonOf = (name: string, e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  if (ext(name) === "ocean" && /JSON|Unexpected|Not an Oceanic/i.test(m)) return "not an Oceanic note file";
  if (isMalwareError(e)) return "blocked: your antivirus flagged it as malware";
  if (/^this zip /.test(m)) return m.slice(5); // size / nesting limits, already in words
  if (/zip|central directory/i.test(m)) return "not a valid zip";
  return m || "unreadable";
};

export async function parseImports(files: InFile[], onFile?: (i: number, name: string) => void): Promise<{ pages: ImportedPage[]; failed: ImportFailure[] }> {
  const out: ImportedPage[] = [];
  const failed: ImportFailure[] = [];
  for (const [i, f] of files.entries()) {
    onFile?.(i, f.name);
    try {
      if (!f.bytes.length) throw new Error("the file is empty");
      await assertClean(f.name, f.bytes); // dropped files never went through the Rust read, which scans too
      if (ext(f.name) === "zip") out.push(...(await fromZip(f.bytes)));
      else if (ext(f.name) === "ocean") {
        const conv = (p: OceanPage): ImportedPage => ({ title: p.title, icon: p.icon, blocks: p.blocks, banner: p.banner, props: { dueDate: p.dueDate, status: p.status, tags: p.tags }, children: p.children.map(conv) });
        const root = await readOceanFile(f.bytes);
        out.push({ ...conv(root), tagColors: root.tagColors });
      }
      else out.push({ title: cleanTitle(f.name), blocks: await toBlocks(f.name, f.bytes), children: [] });
    } catch (e) {
      console.error("Import failed for", f.name, e);
      failed.push({ name: f.name, reason: reasonOf(f.name, e) });
    }
  }
  return { pages: out.map(cleanPage), failed };
}

/** File picker (several files at once). */
export async function pickImportFiles(): Promise<InFile[]> {
  const picked = await open({
    multiple: true,
    title: "Import notes",
    filters: [{ name: "Notes", extensions: ["ocean", "md", "markdown", "txt", "html", "htm", "docx", "zip"] }],
  });
  const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
  return Promise.all(paths.map(async (p) => ({ name: p.split(/[\\/]/).pop()!, bytes: await readFileBytes(p) })));
}
