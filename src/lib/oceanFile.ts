import type { PartialBlock } from "@blocknote/core";
import type { PageMeta } from "../data/workspace";
import { uploadFile } from "../editor/audio";

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
  blocks: PartialBlock[];
  children: OceanPage[];
};
export type OceanFile = { format: "oceanic-note"; version: 1; page: OceanPage; assets: Record<string, string> };

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

export async function buildOceanFile(rootId: string, pages: PageMeta[], loadBlocks: (id: string) => Promise<PartialBlock[]>, includeSubpages: boolean): Promise<Uint8Array> {
  const assets: Record<string, string> = {};
  let n = 0;
  const pack = async (p: PageMeta): Promise<OceanPage> => {
    const blocks = structuredClone(await loadBlocks(p.id));
    const jobs: Promise<void>[] = [];
    eachUrl(blocks, (url, set) => {
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
    const kids = includeSubpages ? pages.filter((c) => c.parentId === p.id) : [];
    return {
      title: p.title,
      icon: p.icon,
      dueDate: p.dueDate ?? null,
      status: p.status ?? null,
      tags: p.tags ?? [],
      blocks,
      children: await Promise.all(kids.map(pack)),
    };
  };
  const root = pages.find((p) => p.id === rootId);
  if (!root) throw new Error("Page not found");
  const file: OceanFile = { format: "oceanic-note", version: 1, page: await pack(root), assets };
  return new TextEncoder().encode(JSON.stringify(file));
}

/** Parse a .ocean file; embedded assets are copied back into Oceanic. */
export async function readOceanFile(bytes: Uint8Array): Promise<OceanPage> {
  const file = JSON.parse(new TextDecoder().decode(bytes)) as OceanFile;
  if (file.format !== "oceanic-note") throw new Error("Not an Oceanic note file");
  const restored: Record<string, string> = {};
  const unpack = async (p: OceanPage) => {
    const jobs: Promise<void>[] = [];
    eachUrl(p.blocks, (url, set) => {
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
    for (const c of p.children) await unpack(c);
  };
  await unpack(file.page);
  return file.page;
}
