import { api } from "../data/api";
import { pageDirectory } from "../editor/pageDirectory";
import { indexChunks, similarity } from "./semantic";

/* Workspace-wide word index for Nerida (BM25). Every note is split into sections at its headings
 * (long sections into ~1200-character chunks at block boundaries); each chunk remembers the block it
 * starts at, so a cited source can open the note right there. The index lives in memory, is built on
 * first use and stays fresh by re-reading only notes whose `updatedAt` changed. Local only. */

export type Chunk = {
  pageId: string;
  /** First block of the chunk (the heading, when there is one). */
  blockId: string | null;
  heading: string;
  /** Plain text, headings as "Heading: …" lines (see nerida.docText). */
  text: string;
  /** Position in the note, for keeping document order. */
  pos: number;
};
type Entry = { updatedAt: string; title: string; chunks: Chunk[]; tf: Map<string, number>[]; len: number[]; titleTerms: Set<string> };

const STOP = new Set(
  ("the and for are but not you your with this that from have has had was were will would can could should what when where which who whom why how " +
    "about into over under than then them they their there these those its it's our out all any some more most such only own same very just also " +
    "does did doing done been being is am be of to in on at by or as an if so do my me we us he she his her him i a " +
    "explain tell show give make please note notes summarize summarise summary").split(" "),
);
/** Lower-case words (any script), stop words dropped, plurals folded ("cells" → "cell"). */
export function terms(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])
    .filter((w) => !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith("ies") ? w.slice(0, -3) + "y" : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

type Node = { id?: string; type?: string; text?: string; content?: Node[] | string; children?: Node[]; props?: { level?: number; checked?: boolean } };
const CHUNK = 1200;

/** BlockNote JSON → section chunks. */
export function chunkDoc(pageId: string, json: string | null | undefined): Chunk[] {
  if (!json) return [];
  const inline = (c: Node["content"]): string => (typeof c === "string" ? c : (c ?? []).map((n) => n.text ?? inline(n.content)).join(""));
  const lines: { id: string | null; text: string; heading: boolean }[] = [];
  const walk = (blocks: Node[], depth: number) => {
    for (const b of blocks) {
      const t = inline(b.content).trim();
      if (t) {
        const indent = "  ".repeat(depth);
        const heading = b.type === "heading";
        const text =
          b.type === "checkListItem" ? `${indent}- ${t} [${b.props?.checked ? "done" : "not done"}]`
          : heading ? `Heading: ${t}`
          : /ListItem$/.test(b.type ?? "") ? `${indent}- ${t}`
          : t;
        lines.push({ id: b.id ?? null, text, heading });
      }
      if (b.children?.length) walk(b.children, depth + 1);
    }
  };
  try {
    walk(JSON.parse(json), 0);
  } catch {
    return [];
  }
  const out: Chunk[] = [];
  let cur: Chunk | null = null;
  let heading = "";
  for (const l of lines) {
    if (l.heading) heading = l.text.slice(9);
    // New chunk at each heading, or when the current one is full (the heading is repeated so the chunk keeps its context).
    if (!cur || l.heading || cur.text.length + l.text.length > CHUNK) {
      const carry: string = !l.heading && cur && heading ? `Heading: ${heading} (continued)\n` : "";
      cur = { pageId, blockId: l.id, heading, text: carry + l.text, pos: out.length };
      out.push(cur);
    } else cur.text += "\n" + l.text;
  }
  return out;
}

/* ------------------------------------------------------------------ index */
const docs = new Map<string, Entry>();
let building: Promise<void> | null = null;

const tfOf = (ws: string[]) => {
  const m = new Map<string, number>();
  for (const w of ws) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
};

function put(id: string, title: string, updatedAt: string, json: string | null | undefined) {
  const chunks = chunkDoc(id, json);
  const ws = chunks.map((c) => terms(c.text));
  docs.set(id, { updatedAt, title, chunks, tf: ws.map(tfOf), len: ws.map((w) => w.length), titleTerms: new Set(terms(title)) });
}

/** Drops these notes from the index so the next refresh re-reads them (e.g. after their pictures were read). */
export const forget = (ids: string[]) => ids.forEach((id) => docs.delete(id));

/** Re-reads notes that changed since they were indexed; drops deleted ones. `only`: just these notes. */
export function refresh(only?: string[]): Promise<void> {
  const run = async () => {
    const { pages } = pageDirectory.get();
    const live = [...pages.values()].filter((p) => !p.trashedAt && (!only || only.includes(p.id)));
    if (!only) for (const id of docs.keys()) if (!pages.has(id) || pages.get(id)!.trashedAt) docs.delete(id);
    const stale = live.filter((p) => docs.get(p.id)?.updatedAt !== (p.updatedAt ?? "") || docs.get(p.id)?.title !== (p.title || "Untitled"));
    // A few at a time: a large workspace shouldn't flood the backend.
    for (let i = 0; i < stale.length; i += 16)
      await Promise.all(
        stale.slice(i, i + 16).map(async (p) => {
          const rec = await api.getPage(p.id).catch(() => null);
          put(p.id, p.title || "Untitled", p.updatedAt ?? "", rec?.content ?? null);
        }),
      );
    // New or edited chunks get meaning vectors in the background (semantic search).
    if (!only) void indexChunks([...docs.values()].flatMap((e) => e.chunks.map((c) => c.text)));
  };
  // Calls queue behind each other, so two refreshes never fetch the same note at once.
  building = (building ?? Promise.resolve()).then(run, run);
  return building;
}

/** Drop a note so it's re-read next time (e.g. right after a save). */
export const invalidate = (id: string) => void docs.delete(id);

export type Hit = Chunk & { title: string; score: number };

/** BM25 (k1 1.2, b 0.75) over chunks; a word in the note title counts as an extra hit. `within`: only these notes. */
function score(q: string, within?: Set<string>): Hit[] {
  const qs = [...new Set(terms(q))];
  if (!qs.length) return [];
  const pool = [...docs.entries()].filter(([id]) => !within || within.has(id));
  let N = 0, total = 0;
  const df = new Map<string, number>();
  for (const [, e] of pool)
    e.tf.forEach((tf, i) => {
      N++;
      total += e.len[i];
      for (const w of qs) if (tf.has(w) || e.titleTerms.has(w)) df.set(w, (df.get(w) ?? 0) + 1);
    });
  if (!N) return [];
  const avg = total / N || 1;
  const hits: Hit[] = [];
  for (const [, e] of pool)
    e.chunks.forEach((c, i) => {
      let s = 0;
      for (const w of qs) {
        const f = (e.tf[i].get(w) ?? 0) + (e.titleTerms.has(w) ? 1 : 0);
        if (!f) continue;
        const idf = Math.log(1 + (N - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
        s += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * e.len[i]) / avg));
      }
      if (s > 0) hits.push({ ...c, title: e.title, score: s });
    });
  return hits.sort((a, b) => b.score - a.score);
}

/** BM25 plus meaning match: a chunk's similarity (0-1) adds up to the top keyword score (at least 3),
 *  so a chunk with no shared words can still rank when it means the same thing. Keyword-only without the search model. */
async function hybrid(q: string, within?: Set<string>): Promise<Hit[]> {
  const hits = score(q, within);
  const flat = [...docs.entries()].filter(([id]) => !within || within.has(id)).flatMap(([, e]) => e.chunks.map((c) => ({ c, title: e.title })));
  const sim = flat.length ? await similarity(q, flat.map((x) => x.c.text)) : null;
  if (!sim) return hits;
  const top = Math.max(hits[0]?.score ?? 0, 3);
  const by = new Map(hits.map((h) => [`${h.pageId}#${h.pos}`, h]));
  flat.forEach(({ c, title }, i) => {
    if (!sim[i]) return;
    const k = `${c.pageId}#${c.pos}`;
    const h = by.get(k);
    if (h) h.score += sim[i] * top;
    else by.set(k, { ...c, title, score: sim[i] * top });
  });
  return [...by.values()].sort((a, b) => b.score - a.score);
}

/** Best-matching chunks across the whole workspace. */
export async function searchChunks(q: string, limit = 20): Promise<Hit[]> {
  await refresh();
  return (await hybrid(q)).slice(0, limit);
}

/** Notes ranked for a question: best chunk + a little for each further matching chunk.
 *  Weak matches (under 35% of the top score, or matching only one rare-ish word in a long query) are dropped. */
export async function searchNotes(q: string, limit = 3, skip: Set<string> = new Set(), strict = false): Promise<{ id: string; title: string; score: number }[]> {
  await refresh();
  // strict (auto-attach while typing): keyword hit on most query words required; meaning-only matches dropped.
  const qn = new Set(terms(q)).size;
  const kw = strict ? new Map<string, number>() : null;
  if (kw) for (const h of score(q)) kw.set(h.pageId, Math.max(kw.get(h.pageId) ?? 0, h.score));
  const by = new Map<string, { id: string; title: string; score: number }>();
  for (const h of await hybrid(q)) {
    if (skip.has(h.pageId)) continue;
    if (kw && (kw.get(h.pageId) ?? 0) < Math.max(2, qn)) continue;
    const x = by.get(h.pageId);
    if (x) x.score += h.score * 0.25;
    else by.set(h.pageId, { id: h.pageId, title: h.title, score: h.score });
  }
  const ranked = [...by.values()].sort((a, b) => b.score - a.score);
  const top = ranked[0]?.score ?? 0;
  const min = Math.max(top * (strict ? 0.6 : 0.35), terms(q).length > 2 ? 1.5 : 0.5);
  return ranked.filter((r) => r.score >= min).slice(0, limit);
}

/** Chunks of the given notes ranked for the question (every chunk of them, zero-scored ones last). */
export async function rankWithin(ids: string[], q: string): Promise<{ chunks: Chunk[]; score: Map<Chunk, number> }> {
  await refresh(ids);
  const chunks = ids.flatMap((id) => docs.get(id)?.chunks ?? []);
  const scoreOf = new Map<Chunk, number>(chunks.map((c) => [c, 0]));
  const byKey = new Map(chunks.map((c) => [`${c.pageId}#${c.pos}`, c]));
  for (const h of await hybrid(q, new Set(ids))) {
    const c = byKey.get(`${h.pageId}#${h.pos}`);
    if (c) scoreOf.set(c, h.score);
  }
  return { chunks, score: scoreOf };
}

/** Characters of text in a note (0 if not indexed yet). */
export const noteChars = (id: string) => docs.get(id)?.chunks.reduce((s, c) => s + c.text.length, 0) ?? 0;
