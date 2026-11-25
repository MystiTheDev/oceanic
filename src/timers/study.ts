/**
 * Study tracking for timers: subjects, a log of studied time, a daily goal and streak.
 * A timer started with a track ("general" or a subject id) credits its focus time here.
 */
import { useSyncExternalStore } from "react";

export type Subject = { id: string; name: string; color: string };
export type Entry = { track: string; day: string; ms: number; note?: string };
type State = { subjects: Subject[]; log: Entry[]; goal: number; ask: ((track: string) => void) | null; review: { track: string; ms: number } | null };

const K = "oceanic:study";
export const COLORS = ["#38bdf8", "#f472b6", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#60a5fa", "#f97316"];
const DEFAULT_SUBJECTS: Subject[] = [
  { id: "phy", name: "Physics", color: "#38bdf8" },
  { id: "chem", name: "Chemistry", color: "#34d399" },
  { id: "math", name: "Math", color: "#a78bfa" },
];
export const GENERAL: Subject = { id: "general", name: "General study", color: "#94a3b8" };

const saved = (() => { try { return JSON.parse(localStorage.getItem(K) ?? "null"); } catch { return null; } })();
let state: State = { subjects: saved?.subjects ?? DEFAULT_SUBJECTS, log: saved?.log ?? [], goal: saved?.goal ?? 60, ask: null, review: null };
const subs = new Set<() => void>();
function set(p: Partial<State>) {
  state = { ...state, ...p };
  try { localStorage.setItem(K, JSON.stringify({ subjects: state.subjects, log: state.log, goal: state.goal })); } catch {}
  subs.forEach((f) => f());
}
export const useStudy = () => useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => state);

export const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const subjectOf = (track: string) => (track === "general" ? GENERAL : state.subjects.find((s) => s.id === track));

/** Ask General / Subject / Don't track before a timer starts; `run` gets "" for don't track. */
export const askTrack = (run: (track: string) => void) => set({ ask: run });
export const answer = (track: string) => { const f = state.ask; set({ ask: null }); f?.(track); };
export const cancelAsk = () => set({ ask: null });

/** Credit studied time; `done` (a finished session of a minute or more) asks for a short note. */
export function credit(track: string, ms: number, done = false) {
  if (!track || ms < 1000) return;
  set({ log: [...state.log, { track, day: dayKey(), ms }], ...(done && ms >= 60e3 ? { review: { track, ms } } : {}) });
}
let sink: ((title: string, text: string) => void) | null = null;
/** App registers how a session note becomes a real note. */
export const setNoteSink = (f: typeof sink) => void (sink = f);
export function saveReview(text: string) {
  const r = state.review;
  set({ review: null });
  if (!r || !text.trim()) return;
  const name = subjectOf(r.track)?.name ?? "Study";
  sink?.(`${name} · ${new Date().toLocaleDateString()}`, `${Math.round(r.ms / 60e3)} min of ${name}.\n${text.trim()}`);
}

export const addSubject = (name: string) => {
  const n = name.trim();
  if (!n) return;
  const id = Math.random().toString(36).slice(2, 9);
  set({ subjects: [...state.subjects, { id, name: n, color: COLORS[state.subjects.length % COLORS.length] }] });
  return id;
};
export const patchSubject = (id: string, p: Partial<Subject>) => set({ subjects: state.subjects.map((s) => (s.id === id ? { ...s, ...p } : s)) });
export const removeSubject = (id: string) => set({ subjects: state.subjects.filter((s) => s.id !== id) });
export const setGoal = (goal: number) => set({ goal: Math.max(5, Math.min(1440, goal)) });

/** Minutes per day for the last `n` days (oldest first), split by track. */
export function days(n: number) {
  const out: { day: string; by: Record<string, number>; total: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = dayKey(Date.now() - i * 864e5);
    const by: Record<string, number> = {};
    for (const e of state.log) if (e.day === day) by[e.track] = (by[e.track] ?? 0) + e.ms / 60e3;
    out.push({ day, by, total: Object.values(by).reduce((a, b) => a + b, 0) });
  }
  return out;
}
/** Days in a row (ending today, or yesterday if today isn't done yet) that hit the goal. */
export function streak() {
  const d = days(366).reverse();
  let i = d[0].total >= state.goal ? 0 : 1, n = 0;
  while (i < d.length && d[i].total >= state.goal) (n++, i++);
  return n;
}
