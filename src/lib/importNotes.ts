import JSZip from "jszip";
import mammoth from "mammoth";
import { BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { schema } from "../editor/schema";
import { uploadFile } from "../editor/audio";

/**
 * Import notes: Markdown, plain text, HTML, Word (.docx) and Notion export
 * zips. Each file becomes a page; a Notion export keeps its page tree.
 */
export type ImportedPage = { title: string; blocks: PartialBlock[]; children: ImportedPage[] };
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
      let md = text().replace(/^# .*\n+/, ""); // the first heading is the page title
      if (rewriteMd) md = await rewriteMd(md);
      return editor().tryParseMarkdownToBlocks(md);
    }
    case "html":
    case "htm":
      return editor().tryParseHTMLToBlocks(text());
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

/** A Notion export: folders hold a page's subpages; images are copied into Oceanic. */
async function fromZip(bytes: Uint8Array): Promise<ImportedPage[]> {
  const zip = await JSZip.loadAsync(bytes);
  // Notion sometimes nests the real export zip inside the outer one.
  const inner = Object.values(zip.files).filter((f) => !f.dir && f.name.toLowerCase().endsWith(".zip"));
  if (inner.length && !Object.keys(zip.files).some((n) => /\.(md|html?)$/i.test(n))) {
    return (await Promise.all(inner.map(async (f) => fromZip(await f.async("uint8array"))))).flat();
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
        const url = await uploadFile(new File([await img.async("uint8array") as BlobPart], rel.split("/").pop()!)).catch(() => null);
        if (url) md = md.split(m[1]).join(url);
      }
      return md;
    };
    const page: ImportedPage = { title: cleanTitle(f.name.split("/").pop()!), blocks: await toBlocks(f.name, await f.async("uint8array"), rewrite), children: [] };
    byPath.set(f.name.replace(/\.(md|markdown|html?|txt)$/i, ""), page);
    const parent = byPath.get(dir);
    if (parent) parent.children.push(page);
    else roots.push(page);
  }
  return roots;
}

export async function parseImports(files: InFile[]): Promise<ImportedPage[]> {
  const out: ImportedPage[] = [];
  for (const f of files) {
    try {
      if (ext(f.name) === "zip") out.push(...(await fromZip(f.bytes)));
      else out.push({ title: cleanTitle(f.name), blocks: await toBlocks(f.name, f.bytes), children: [] });
    } catch (e) {
      console.error("Import failed for", f.name, e);
    }
  }
  return out;
}

/** File picker (several files at once). */
export async function pickImportFiles(): Promise<InFile[]> {
  const picked = await open({
    multiple: true,
    title: "Import notes",
    filters: [{ name: "Notes", extensions: ["md", "markdown", "txt", "html", "htm", "docx", "zip"] }],
  });
  const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
  return Promise.all(paths.map(async (p) => ({ name: p.split(/[\\/]/).pop()!, bytes: new Uint8Array(await invoke<number[]>("docs_read", { path: p })) })));
}
