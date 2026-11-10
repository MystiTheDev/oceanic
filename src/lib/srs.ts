import { useSyncExternalStore } from "react";
import { api } from "../data/api";
import { isoDate, parseIsoDate } from "./colors";

/* Flashcards & spaced repetition.
 * Cards live in notes: a bullet `Question :: Answer` (or `??`), a `{{cloze}}` bullet,
 * or any block marked via right-click → "Make flashcard".
 * Only the schedule (+ a text snapshot for the review screen) is stored here. */

export type Card = {
  /** blockId, or `blockId#n` for the n-th cloze of a block. */
  id: string;
  blockId: string;
  pageId: string;
  q: string;
  a: string;
  /** Cloze: full text with `{{…}}`; `q` hides the n-th one. */
  cloze?: string;
  due: string; // YYYY-MM-DD
  interval: number; // days
  ease: number;
  reps: number;
  lapses: number;
};
export type Grade = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy
export const GRADES: { g: Grade; label: string }[] = [
  { g: 1, label: "Again" }, { g: 2, label: "Hard" }, { g: 3, label: "Good" }, { g: 4, label: "Easy" },
];

/* ------------------------------------------------------------ scheduler (SM-2 lite) */
/** `examDate` caps the interval so the card is seen again before the exam. */
export function review(c: Card, g: Grade, examDate?: string, today = new Date()): Card {
  let { interval, ease, reps, lapses } = c;
  if (g === 1) {
    reps = 0; lapses++; interval = 0; ease = Math.max(1.3, ease - 0.2);
  } else {
    reps++;
    ease = Math.max(1.3, ease + (g === 2 ? -0.15 : g === 4 ? 0.15 : 0));
    interval = reps === 1 ? (g === 4 ? 3 : 1) : reps === 2 ? (g === 2 ? 2 : g === 4 ? 6 : 3)
      : Math.max(interval + 1, Math.round(interval * ease * (g === 2 ? 0.8 : g === 4 ? 1.3 : 1)));
  }
  if (examDate) {
    const left = Math.round((parseIsoDate(examDate).getTime() - parseIsoDate(isoDate(today)).getTime()) / 864e5);
    // Before the exam: at most halfway there, so there's a second look. Exam day or after: no cap.
    if (left > 0) interval = Math.min(interval, Math.max(1, Math.floor(left / 2)));
  }
  const d = new Date(today);
  d.setDate(d.getDate() + interval);
  return { ...c, interval, ease, reps, lapses, due: isoDate(d) };
}
/** "10m", "3d", "2mo" — shown under the grade buttons. */
export const previewLabel = (c: Card, g: Grade, examDate?: string) => {
  const n = review(c, g, examDate).interval;
  return n === 0 ? "<1d" : n < 30 ? `${n}d` : n < 365 ? `${Math.round(n / 30)}mo` : `${(n / 365).toFixed(1)}y`;
};

/* ------------------------------------------------------------ parsing notes */
type Block = { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: Block[] };
const BULLETS = new Set(["bulletListItem", "numberedListItem"]);
const CLOZE = /\{\{(.+?)\}\}/g;

type Styles = { bold?: boolean; italic?: boolean; code?: boolean };
/** Bold/italic/code kept as `**x**`, `*x*`, `` `x` `` so cards stay plain strings. */
const styled = (t: string, st: Styles = {}) => (st.code ? `\`${t}\`` : st.bold && st.italic ? `***${t}***` : st.bold ? `**${t}**` : st.italic ? `*${t}*` : t);
/** Card text without the formatting marks (for plain-text uses like quizzes). */
export const plainText = (s: string) => s.replace(/(\*{1,3}|`)(.+?)\1/g, "$2");
export const blockText = (b: Block): string => {
  const c = b.content;
  if (!Array.isArray(c)) return "";
  return c.map((n: { type?: string; text?: string; styles?: Styles; content?: unknown; props?: { latex?: string } }) =>
    n.type === "text" ? styled(n.text ?? "", n.styles) : n.type === "link" && Array.isArray(n.content) ? n.content.map((t: { text?: string }) => t.text ?? "").join("") : n.type === "inlineMath" ? `$${n.props?.latex ?? ""}$` : "",
  ).join("");
};
const childrenText = (b: Block) => (b.children ?? []).map(blockText).filter(Boolean).join("\n");

/** `Q :: A` / `Q ?? A` → {q, a}. */
export function parseQA(text: string): { q: string; a: string } | null {
  const m = text.match(/^(.+?)\s*(?:::|\?\?)\s*(.+)$/s);
  return m ? { q: m[1].trim(), a: m[2].trim() } : null;
}
/** Marked block: first line is the question; rest (or the nested blocks) is the answer. */
function parseMarked(b: Block): { q: string; a: string } | null {
  const text = blockText(b);
  const qa = parseQA(text);
  if (qa) return qa;
  const [q, ...rest] = text.split("\n");
  const a = rest.join("\n").trim() || childrenText(b);
  return q.trim() && a ? { q: q.trim(), a } : null;
}

type Found = Pick<Card, "id" | "blockId" | "q" | "a" | "cloze">;
/** Every card in a page's blocks. `marked` = block ids made cards via the menu. */
export function findCards(blocks: Block[], marked: Set<string>): Found[] {
  const out: Found[] = [];
  const walk = (list: Block[]) => {
    for (const b of list) {
      if (b.id) {
        const text = blockText(b);
        const clozes = [...text.matchAll(CLOZE)];
        if (clozes.length && (BULLETS.has(b.type ?? "") || marked.has(b.id))) {
          clozes.forEach((m, n) => {
            let i = -1;
            const q = text.replace(CLOZE, (_, w) => (++i === n ? "[ … ]" : w));
            out.push({ id: `${b.id}#${n}`, blockId: b.id!, q, a: m[1], cloze: text });
          });
        } else {
          const qa = marked.has(b.id) ? parseMarked(b) : BULLETS.has(b.type ?? "") ? parseQA(text) : null;
          if (qa) out.push({ id: b.id, blockId: b.id, ...qa });
        }
      }
      if (b.children?.length) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

/* ------------------------------------------------------------ store */
type Srs = { cards: Record<string, Card>; marked: string[]; newPerDay: number; newToday: { date: string; n: number } };
const KEYS = { cards: "srsCards", marked: "srsMarked", newPerDay: "srsNewPerDay", newToday: "srsNewToday" } as const;
let state: Srs = { cards: {}, marked: [], newPerDay: 20, newToday: { date: "", n: 0 } };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export const useSrs = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state);
export const getSrs = () => state;

export function loadSrs(stored: Record<string, string>) {
  const read = <T,>(k: string, f: T): T => {
    try { return stored[k] ? (JSON.parse(stored[k]) as T) : f; } catch { return f; }
  };
  state = { cards: read(KEYS.cards, {}), marked: read(KEYS.marked, []), newPerDay: read(KEYS.newPerDay, 20), newToday: read(KEYS.newToday, { date: "", n: 0 }) };
  emit();
}
export function set<K extends keyof Srs>(key: K, value: Srs[K]) {
  state = { ...state, [key]: value };
  emit();
  api.setSetting(KEYS[key], JSON.stringify(value)).catch(() => {});
}

/** Called on every page edit: adds new cards, refreshes text, drops removed ones. Schedules are kept. */
export function syncPage(pageId: string, blocks: Block[]) {
  const found = findCards(blocks, new Set(state.marked));
  const next: Record<string, Card> = {};
  let changed = false;
  for (const [id, c] of Object.entries(state.cards)) if (c.pageId !== pageId) next[id] = c;
  for (const f of found) {
    const old = state.cards[f.id];
    next[f.id] = old ? { ...old, ...f, pageId } : { ...f, pageId, due: isoDate(new Date()), interval: 0, ease: 2.5, reps: 0, lapses: 0 };
    if (!old || old.q !== f.q || old.a !== f.a || old.cloze !== f.cloze) changed = true;
  }
  const before = Object.values(state.cards).filter((c) => c.pageId === pageId).length;
  if (changed || before !== found.length) set("cards", next);
}

export const isMarked = (blockId: string) => state.marked.includes(blockId);
export function toggleMarked(blockId: string) {
  set("marked", isMarked(blockId) ? state.marked.filter((id) => id !== blockId) : [...state.marked, blockId]);
}
export const isNew = (c: Card) => !c.reps && !c.lapses && !c.interval;
export function grade(card: Card, g: Grade, examDate?: string) {
  const today = isoDate(new Date());
  if (isNew(card)) set("newToday", { date: today, n: (state.newToday.date === today ? state.newToday.n : 0) + 1 });
  set("cards", { ...state.cards, [card.id]: review(card, g, examDate) });
}
/** Due cards, optionally for one page; soonest first. Never-reviewed cards are capped by "new cards per day". */
export function dueCards(cards: Record<string, Card>, pageId?: string, today = isoDate(new Date())) {
  let room = state.newPerDay - (state.newToday.date === today ? state.newToday.n : 0);
  return Object.values(cards)
    .filter((c) => c.due <= today && (!pageId || c.pageId === pageId))
    .sort((a, b) => a.due.localeCompare(b.due))
    .filter((c) => !isNew(c) || room-- > 0);
}

/** Once at startup: pick up cards in notes not edited since cards existed; drop cards of deleted pages. */
export async function scanAll(pageIds: string[]) {
  const keep = new Set(pageIds);
  if (Object.values(state.cards).some((c) => !keep.has(c.pageId)))
    set("cards", Object.fromEntries(Object.entries(state.cards).filter(([, c]) => keep.has(c.pageId))));
  for (const id of pageIds) {
    const p = await api.getPage(id).catch(() => null);
    if (!p?.content) continue;
    try { syncPage(id, JSON.parse(p.content)); } catch {}
  }
}
