import { invoke, isTauri } from "@tauri-apps/api/core";
import { api } from "../data/api";
import { engine } from "./nerida";

/* Semantic search: each note chunk gets a 384-number meaning vector from a small CPU model
 * (bge-small-en), so "light reactions" finds a note about photosynthesis with no shared words.
 * Vectors are made in the background, kept by a hash of the chunk's text (an edit re-embeds only the
 * changed chunks) and saved to settings as 8-bit numbers. Keyword search (BM25) still runs alongside. */

const KEY = "neridaVectors";
const DIM = 384;
/** bge wants this prefix on queries (not on passages). */
const QUERY = "Represent this sentence for searching relevant passages: ";

let vecs = new Map<string, Int8Array>();
let loaded: Promise<void> | null = null;
let ready = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const queryCache = new Map<string, Float32Array>();

/** Hash of a chunk's text: same text, same vector. */
export function textKey(t: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36) + t.length.toString(36);
}

const toB64 = (a: Int8Array) => btoa(String.fromCharCode(...new Uint8Array(a.buffer, a.byteOffset, a.byteLength)));
const fromB64 = (s: string) => new Int8Array(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer);
const quantize = (v: number[]) => Int8Array.from(v, (x) => Math.max(-127, Math.min(127, Math.round(x * 127))));

function load() {
  loaded ??= (async () => {
    try {
      const s = (await api.getSettings())[KEY];
      if (s) vecs = new Map(Object.entries(JSON.parse(s) as Record<string, string>).map(([k, v]) => [k, fromB64(v)]));
    } catch {
      /* start empty */
    }
    ready = isTauri() && (await engine.status().then((s) => s.embed, () => false));
    if (!ready) void ensureModel();
  })();
  return loaded;
}

/** Saves after a quiet second; keeps only the vectors of chunks that still exist. */
function save(live?: Set<string>) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (live) for (const k of vecs.keys()) if (!live.has(k)) vecs.delete(k);
    void api.setSetting(KEY, JSON.stringify(Object.fromEntries([...vecs].map(([k, v]) => [k, toB64(v)])))).catch(() => {});
  }, 1000);
}

const embed = (texts: string[]) => invoke<number[][]>("ai_embed", { texts });

/** True once the search model is on disk. */
export async function semanticReady() {
  await load();
  return ready;
}

/** Fetches the search model quietly when Nerida is installed but the model isn't (it ships with the chat model). */
export async function ensureModel() {
  if (!isTauri()) return;
  const s = await engine.status().catch(() => null);
  if (!s || s.embed || !s.server || !s.models.some((m) => m.installed)) return;
  try {
    await engine.download("embed", () => {});
    ready = true;
  } catch {
    /* offline: keyword search only, try again next launch */
  }
}

let indexing = false;
/** Embeds chunks that have no vector yet, 32 at a time, pausing while Nerida is answering. */
export async function indexChunks(texts: string[]) {
  await load();
  if (!ready || indexing) return;
  indexing = true;
  try {
    const keys = texts.map(textKey);
    const todo = [...new Map(texts.map((t, i) => [keys[i], t])).entries()].filter(([k]) => !vecs.has(k));
    for (let i = 0; i < todo.length; i += 32) {
      while (engine.busy()) await new Promise((r) => setTimeout(r, 2000));
      const batch = todo.slice(i, i + 32);
      const out = await embed(batch.map(([, t]) => t));
      batch.forEach(([k], j) => out[j]?.length === DIM && vecs.set(k, quantize(out[j])));
      await new Promise((r) => setTimeout(r, 50)); // leave the CPU to the app between batches
    }
    save(new Set(keys));
  } catch {
    /* engine missing or busy: try again on the next refresh */
  } finally {
    indexing = false;
  }
}

/** Meaning match (0-1) of the question to each text that has a vector; null when semantic search is off. */
export async function similarity(q: string, texts: string[]): Promise<number[] | null> {
  await load();
  if (!ready || !q.trim()) return null;
  let qv = queryCache.get(q);
  if (!qv) {
    try {
      const [v] = await embed([QUERY + q]);
      if (v?.length !== DIM) return null;
      qv = Float32Array.from(v);
      queryCache.set(q, qv);
      if (queryCache.size > 50) queryCache.delete(queryCache.keys().next().value!);
    } catch {
      return null;
    }
  }
  return texts.map((t) => {
    const v = vecs.get(textKey(t));
    if (!v) return 0;
    let dot = 0;
    for (let i = 0; i < DIM; i++) dot += v[i] * qv![i];
    // Cosine of a normalized query and a 1/127-scaled vector; bge puts unrelated text near 0.5.
    return Math.max(0, (dot / 127 - 0.55) / 0.35);
  });
}
