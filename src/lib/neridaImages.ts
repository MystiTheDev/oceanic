import { api } from "../data/api";
import { builtin, engine, nerida } from "./nerida";

/* Nerida + pictures. The Vision add-on reads a picture once into plain text (the words in it,
 * plus a short description); that reading is saved, so notes with pictures and attached
 * images then work like any other text: chat context, search, flashcards and tests. */

const KEY = (url: string) => `imgRead:${url}`;
const MAX_SIDE = 768; // same as scanned PDF pages: bigger images take minutes before the first word
const PROMPT =
  "Read this picture for a student's notes. First copy all the text in it exactly, in reading order. " +
  "Then add one line that starts with \"Picture:\" and says in 1-2 sentences what it shows (for example a diagram, chart, photo or handwritten page). " +
  "Output only that, no comments.";

const cache = new Map<string, string>();
let loaded: Promise<void> | null = null;
const load = () => (loaded ??= api.getSettings().then((s) => {
  for (const [k, v] of Object.entries(s)) if (k.startsWith("imgRead:")) cache.set(k.slice(8), v);
}).catch(() => {}));

/** Saved reading of a picture, or undefined if it hasn't been read (sync, for note text). */
export const imageReading = (url: string) => cache.get(url);

/** True when the current model can look at pictures: the built-in engine with Vision, or an outside model (tried). */
export async function canSeeImages(): Promise<boolean> {
  return builtin(nerida.get().model) ? !!(await engine.status().catch(() => null))?.vision : true;
}

/** A picture (URL or file) as a JPEG data URL no bigger than MAX_SIDE. */
export async function shrink(src: string | Blob, side = MAX_SIDE): Promise<string> {
  const blob = typeof src === "string" ? await fetch(src).then((r) => r.blob()) : src;
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff"; // transparent PNGs: white paper, not black
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

/** Reads one picture with the model: its text, then a "Picture: …" description. */
export async function readImage(src: string | Blob): Promise<string> {
  const model = nerida.get().model;
  const b = builtin(model);
  if (b) await engine.start(b);
  let out = "";
  await engine.chat(model, [{ role: "user", content: [{ type: "text", text: PROMPT }, { type: "image_url", image_url: { url: await shrink(src) } }] }], (t) => {
    out += t;
    if (out.length > 4000) void engine.stop(); // runaway output
  });
  return out.trim() || "(no text found)";
}

type Block = { type?: string; props?: { url?: string }; children?: Block[] };
/** Picture URLs in a note's saved content, in order. */
export function noteImages(json: string | null | undefined): string[] {
  const out: string[] = [];
  const walk = (bs: Block[]) => bs.forEach((b) => (b.type === "image" && b.props?.url && out.push(b.props.url), b.children && walk(b.children)));
  try {
    walk(JSON.parse(json || "[]"));
  } catch {
    /* not a note document */
  }
  return out;
}

/** Pictures in these notes that haven't been read yet. */
export async function unreadImages(pageIds: string[]): Promise<string[]> {
  await load();
  const urls: string[] = [];
  for (const id of pageIds) for (const u of noteImages((await api.getPage(id).catch(() => null))?.content)) if (!cache.has(u) && !urls.includes(u)) urls.push(u);
  return urls;
}

/** Reads every unread picture in these notes (once; saved). Returns how many were read. */
export async function readNoteImages(pageIds: string[], onImage?: (n: number, total: number) => void): Promise<number> {
  const todo = await unreadImages(pageIds);
  if (!todo.length || !(await canSeeImages())) return 0;
  for (const [i, url] of todo.entries()) {
    onImage?.(i + 1, todo.length);
    const text = await readImage(url).catch(() => "");
    if (!text) continue; // failed: try again next time
    cache.set(url, text);
    await api.setSetting(KEY(url), text).catch(() => {});
  }
  return todo.length;
}

// Warm the cache so note text includes readings from the start.
void load();
