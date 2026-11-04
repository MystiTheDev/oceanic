import type { PartialBlock } from "@blocknote/core";
import type { PageMeta } from "../data/workspace";
import { uploadFile } from "../editor/audio";
import { api, type PdfAnnotationRecord } from "../data/api";
import { getPdfBytes } from "../pdf/bytes";
import { finishImport } from "../pdf/pdfjs";
import { getBanner, type Banner } from "./banners";

/**
 * Oceanic's own note file (.ocean): JSON with a page, its subpages, their
 * properties and every embedded image/file, so it round-trips exactly.
 */
export type OceanPage = {
  title: string;
  icon: string;
  dueDate: string | null;
  status: string | null;
  tags: string[];
  banner?: Banner | null;
  blocks: PartialBlock[];
  children: OceanPage[];
};
/** A PDF used by the exported pages: the file (base64) plus its annotations, keyed by its old doc id. */
export type OceanPdf = { name: string; data: string; lastPage: number; zoom: string; annotations: PdfAnnotationRecord[] };
export type OceanFile = {
  format: "oceanic-note";
  version: 1;
  page: OceanPage;
  assets: Record<string, string>;
  pdfs?: Record<string, OceanPdf>;
  /** Colors of the tags used, so custom tags can be recreated on import. */
  tagColors?: Record<string, string>;
  /** False when exported without date/status/tags. */
  hasMeta?: boolean;
};

type AnyBlock = { type?: string; props?: Record<string, unknown>; content?: unknown; children?: AnyBlock[] };

/** Every PDF reference in the blocks: pdf blocks and `p. N` chips (`set` rewrites its ids). */
function eachPdfRef(blocks: PartialBlock[], fn: (props: Record<string, unknown>, set: (p: Record<string, unknown>) => void) => void) {
  for (const b of blocks as AnyBlock[]) {
    if (b.type === "pdf" && b.props) fn(b.props, (p) => Object.assign(b.props!, p));
    if (Array.isArray(b.content)) {
      for (const c of b.content as AnyBlock[]) if (c.type === "pdfRef" && c.props) fn(c.props, (p) => Object.assign(c.props!, p));
    }
    if (b.children?.length) eachPdfRef(b.children as PartialBlock[], fn);
  }
}

/** Media URLs inside blocks (image/video/audio/file `url` props). */
function eachUrl(blocks: PartialBlock[], fn: (url: string, set: (v: string) => void) => void) {
  for (const b of blocks as { props?: Record<string, unknown>; children?: PartialBlock[] }[]) {
    const props = b.props;
    for (const key of ["url", "src"]) {
      const v = props?.[key];
      if (typeof v === "string" && v && !v.startsWith("data:") && !/^https?:\/\/(?!asset\.localhost|ipc\.localhost)/.test(v)) fn(v, (nv) => (props![key] = nv));
    }
    if (b.children?.length) eachUrl(b.children, fn);
  }
}

const toBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export async function buildOceanFile(rootId: string, pages: PageMeta[], loadBlocks: (id: string) => Promise<PartialBlock[]>, includeSubpages: boolean, includeMeta = true): Promise<Uint8Array> {
  const assets: Record<string, string> = {};
  let n = 0;
  const pack = async (p: PageMeta): Promise<OceanPage> => {
    const blocks = structuredClone(await loadBlocks(p.id));
    const jobs: Promise<void>[] = [];
    const b = getBanner(p.id);
    const banner = b ? { ...b } : null;
    // The banner image travels as an asset too (a pseudo-block for eachUrl).
    const all = banner && !banner.src.startsWith("css:") ? [...blocks, { props: { url: banner.src } } as PartialBlock] : blocks;
    eachUrl(all, (url, set) => {
      const key = `asset${n++}`;
      jobs.push(
        fetch(url)
          .then(async (r) => {
            assets[key] = `${r.headers.get("content-type") ?? "application/octet-stream"};${toBase64(new Uint8Array(await r.arrayBuffer()))}`;
            set(`oceanic-asset:${key}`);
          })
          .catch(() => {}),
      );
    });
    await Promise.all(jobs);
    if (banner && all !== blocks) banner.src = ((all[all.length - 1] as { props: { url: string } }).props.url);
    const kids = includeSubpages ? pages.filter((c) => c.parentId === p.id) : [];
    return {
      title: p.title,
      icon: p.icon,
      dueDate: includeMeta ? (p.dueDate ?? null) : null,
      status: includeMeta ? (p.status ?? null) : null,
      tags: includeMeta ? (p.tags ?? []) : [],
      banner,
      blocks,
      children: await Promise.all(kids.map(pack)),
    };
  };
  const root = pages.find((p) => p.id === rootId);
  if (!root) throw new Error("Page not found");
  const page = await pack(root);
  // PDFs travel with their annotations.
  const ids = new Set<string>();
  const collect = (p: OceanPage) => {
    eachPdfRef(p.blocks, (props) => typeof props.docId === "string" && props.docId && ids.add(props.docId));
    p.children.forEach(collect);
  };
  collect(page);
  const pdfs: Record<string, OceanPdf> = {};
  for (const id of ids) {
    const doc = await api.getPdfDoc(id).catch(() => null);
    if (!doc) continue;
    const bytes = await getPdfBytes(doc.assetPath).catch(() => null);
    if (!bytes) continue;
    pdfs[id] = { name: doc.name, data: toBase64(bytes), lastPage: doc.lastPage, zoom: doc.zoom, annotations: await api.getPdfAnnotations(id) };
  }
  const tagColors: Record<string, string> = {};
  if (includeMeta) {
    const colors = JSON.parse((await api.getSettings().catch(() => ({}) as Record<string, string>)).tagColors ?? "{}") as Record<string, string>;
    const walk = (p: OceanPage) => (p.tags.forEach((t) => colors[t] && (tagColors[t] = colors[t])), p.children.forEach(walk));
    walk(page);
  }
  const file: OceanFile = { format: "oceanic-note", version: 1, page, assets, pdfs, tagColors, hasMeta: includeMeta };
  return new TextEncoder().encode(JSON.stringify(file));
}

/** Parse a .ocean file; embedded assets are copied back into Oceanic. */
export async function readOceanFile(bytes: Uint8Array): Promise<OceanPage & { tagColors: Record<string, string> }> {
  const file = JSON.parse(new TextDecoder().decode(bytes)) as OceanFile;
  if (file.format !== "oceanic-note") throw new Error("Not an Oceanic note file");
  const restored: Record<string, string> = {};
  const unpack = async (p: OceanPage) => {
    const jobs: Promise<void>[] = [];
    const bannerRef = p.banner && !p.banner.src.startsWith("css:") ? [{ props: { url: p.banner.src } } as PartialBlock] : [];
    eachUrl([...p.blocks, ...bannerRef], (url, set) => {
      const key = url.replace("oceanic-asset:", "");
      const raw = file.assets[key];
      if (!url.startsWith("oceanic-asset:") || !raw) return;
      jobs.push(
        (async () => {
          if (!restored[key]) {
            const [mime, b64] = [raw.slice(0, raw.indexOf(";")), raw.slice(raw.indexOf(";") + 1)];
            const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            const ext = mime.split("/")[1]?.split("+")[0] ?? "bin";
            restored[key] = await uploadFile(new File([bin], `${key}.${ext}`, { type: mime }));
          }
          set(restored[key]);
        })(),
      );
    });
    await Promise.all(jobs);
    if (p.banner && bannerRef.length) p.banner.src = (bannerRef[0].props as { url: string }).url;
    for (const c of p.children) await unpack(c);
  };
  await unpack(file.page);

  // Bundled PDFs come back as new docs; blocks and chips are pointed at them.
  const docIds: Record<string, string> = {};
  const annIds: Record<string, string> = {};
  for (const [oldId, pdf] of Object.entries(file.pdfs ?? {})) {
    const doc = await api.importPdfBytes(pdf.name, pdf.data);
    docIds[oldId] = doc.id;
    const rows = pdf.annotations.map((a) => {
      annIds[a.id] = crypto.randomUUID();
      return { ...a, id: annIds[a.id], docId: doc.id };
    });
    if (rows.length) await api.batchPdfAnnotations(rows, []);
    await api.savePdfDocState(doc.id, 0, pdf.lastPage, pdf.zoom);
    void finishImport({ ...doc, lastPage: pdf.lastPage, zoom: pdf.zoom }).catch(() => {});
  }
  const remap = (p: OceanPage) => {
    eachPdfRef(p.blocks, (props, set) => {
      const docId = docIds[props.docId as string];
      if (docId) set({ docId, ...(props.annotationId ? { annotationId: annIds[props.annotationId as string] ?? "" } : {}) });
    });
    p.children.forEach(remap);
  };
  remap(file.page);
  return { ...file.page, tagColors: file.tagColors ?? {} };
}
