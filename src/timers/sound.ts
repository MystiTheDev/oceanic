/** Timer chimes: three built-in synth sounds plus one custom file kept in IndexedDB. */
export type SoundId = "chime" | "bell" | "beep" | "custom";
export const SOUNDS: [SoundId, string][] = [["chime", "Chime"], ["bell", "Bell"], ["beep", "Beep"], ["custom", "Custom"]];
export const MAX_CUSTOM = 2 * 1024 * 1024;

let ac: AudioContext | null = null;
const ctx = () => (ac ??= new AudioContext());

function tone(freq: number, at: number, len: number, vol: number, type: OscillatorType = "sine") {
  const a = ctx();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(g).connect(a.destination);
  o.start(at);
  o.stop(at + len + 0.05);
}

/* ---------------------------------------------------------- custom sound (IndexedDB) */
const DB = "oceanic-timers", STORE = "sound", KEY = "custom";
const db = () =>
  new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
const tx = <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) =>
  db().then((d) => new Promise<T>((res, rej) => {
    const q = fn(d.transaction(STORE, mode).objectStore(STORE));
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  }));

let customUrl: string | null = null;
export async function loadCustom() {
  try {
    const b = await tx<Blob | undefined>("readonly", (s) => s.get(KEY));
    if (customUrl) URL.revokeObjectURL(customUrl);
    customUrl = b ? URL.createObjectURL(b) : null;
  } catch {
    customUrl = null;
  }
  return !!customUrl;
}
/** Save a custom sound. Throws a readable message when the file is not usable. */
export async function saveCustom(f: File) {
  if (f.size > MAX_CUSTOM) throw new Error("That file is over 2 MB.");
  if (!f.type.startsWith("audio/")) throw new Error("Pick an audio file (mp3, wav or ogg).");
  await tx("readwrite", (s) => s.put(f, KEY));
  await loadCustom();
}
export async function clearCustom() {
  try { await tx("readwrite", (s) => s.delete(KEY)); } catch {}
  await loadCustom();
}
void loadCustom();

/** Very short click for manually stopping / resetting a timer. */
export function tick(vol = 0.6) {
  if (vol <= 0) return;
  try {
    const a = ctx();
    if (a.state === "suspended") void a.resume();
    tone(1200, a.currentTime + 0.02, 0.07, vol * 0.25, "square");
  } catch {}
}

/** Play one ring of the sound. `vol` is 0–1. */
export function play(id: SoundId, vol: number) {
  if (vol <= 0) return;
  if (id === "custom" && customUrl) {
    const a = new Audio(customUrl);
    a.volume = Math.min(1, vol);
    void a.play().catch(() => {});
    return;
  }
  try {
    const a = ctx();
    if (a.state === "suspended") void a.resume();
    const t = a.currentTime + 0.02, v = vol * 0.4;
    if (id === "bell") [523, 1046, 1568].forEach((f, i) => tone(f, t, 1.6 - i * 0.3, v / (i + 1)));
    else if (id === "beep") [0, 0.18, 0.36].forEach((d) => tone(880, t + d, 0.12, v * 0.6, "square"));
    else (tone(784, t, 0.6, v), tone(1175, t + 0.22, 0.9, v));
  } catch {}
}
