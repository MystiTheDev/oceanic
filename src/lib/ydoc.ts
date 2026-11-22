// LAN sync 7c: a page body lives in a Yjs doc (BlockNote's Y.XmlFragment) so
// edits made on two devices merge. The JSON `content` stays as a copy for
// search, previews and everything that reads pages without an editor.
import * as Y from "yjs";
import { BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import { blocksToYXmlFragment, yXmlFragmentToBlocks } from "@blocknote/core/yjs";
import { schema } from "../editor/schema";
import { api } from "../data/api";

export const FRAGMENT = "doc";
/** Version history → "Restore": the open editor applies it, else the app saves it. */
export const RESTORE_VERSION = "oc-restore-version";
export type RestoreDetail = { pageId: string; blocks: PartialBlock[]; handled?: boolean };

/**
 * Yjs docs of pages opened in an editor. `json` is the body the editor last
 * reported: a save sends the doc only while the body still matches it.
 * `mounted` turns false on close; the entry stays for the last debounced save.
 */
export const liveDocs = new Map<string, { doc: Y.Doc; json: string; mounted: boolean }>();

const toB64 = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const encodeDoc = (d: Y.Doc) => toB64(Y.encodeStateAsUpdate(d));

/** The live doc to save with `json`, if the editor produced that body. */
export function ydocFor(pageId: string, json: string): string | undefined {
  const live = liveDocs.get(pageId);
  if (live && !live.mounted) liveDocs.delete(pageId);
  return live && live.json === json ? encodeDoc(live.doc) : undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let headless: BlockNoteEditor<any, any, any> | null = null;
const converter = () => (headless ??= BlockNoteEditor.create({ schema }));

/** FNV-1a: the same body migrates to the same Yjs items on every device, so two migrations don't double it. */
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0 || 1;
};

/** A page's Yjs doc: the stored one, or migrated from its JSON body. `stale`: replay `blocks` into it. */
export async function loadDoc(pageId: string, blocks: PartialBlock[]): Promise<{ doc: Y.Doc; stale: boolean }> {
  const doc = new Y.Doc();
  const r = await api.pageYdoc(pageId).catch(() => null);
  if (r?.ydoc) {
    Y.applyUpdate(doc, fromB64(r.ydoc));
    return { doc, stale: r.ydocStale };
  }
  const seed = new Y.Doc();
  seed.clientID = hash(JSON.stringify(blocks));
  blocksToYXmlFragment(converter(), blocks as never, seed.getXmlFragment(FRAGMENT));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed));
  return { doc, stale: false };
}

/**
 * After a sync merged page bodies: open editors take the merged doc (and save
 * as usual); closed pages get their JSON body rebuilt here.
 */
export async function rebuildMerged(save: (id: string, blocks: PartialBlock[], ydoc: string) => Promise<unknown>) {
  for (const id of await api.contentStalePages()) {
    const r = await api.pageYdoc(id).catch(() => null);
    if (!r?.ydoc) continue;
    const live = liveDocs.get(id);
    if (live?.mounted) {
      Y.applyUpdate(live.doc, fromB64(r.ydoc), "sync");
      continue;
    }
    const d = new Y.Doc();
    Y.applyUpdate(d, fromB64(r.ydoc));
    await save(id, yXmlFragmentToBlocks(converter(), d.getXmlFragment(FRAGMENT)) as PartialBlock[], r.ydoc);
  }
}
