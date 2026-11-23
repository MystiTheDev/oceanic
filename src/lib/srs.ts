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
  /** FSRS memory: days until recall drops to 90%, and how hard the card is (1-10). Missing on cards from before FSRS. */
  stability?: number;
  difficulty?: number;
  /** Last review (YYYY-MM-DD). */
  last?: string;
};
export type Grade = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy
export const GRADES: { g: Grade; label: string }[] = [
  { g: 1, label: "Again" }, { g: 2, label: "Hard" }, { g: 3, label: "Good" }, { g: 4, label: "Easy" },
];

/* ------------------------------------------------------------ scheduler (FSRS-5) */
/* FSRS-5 with its default weights, aiming for 90% recall: the next review falls when the card's
 * predicted recall drops to 90%, which is `stability` days after the last one. */
const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const DECAY = -0.5, FACTOR = 19 / 81;
const clampD = (d: number) => Math.min(10, Math.max(1, d));
const initD = (g: Grade) => clampD(W[4] - Math.exp(W[5] * (g - 1)) + 1);
/** Chance of recalling a card `t` days after its last review. */
export const recall = (t: number, s: number) => Math.pow(1 + (FACTOR * t) / s, DECAY);
const daysBetween = (a: string, b: string) => Math.round((parseIsoDate(b).getTime() - parseIsoDate(a).getTime()) / 864e5);

/** `examDate` caps the interval so the card is seen again before the exam. */
export function review(c: Card, g: Grade, examDate?: string, today = new Date()): Card {
  const now = isoDate(today);
  let { reps, lapses } = c;
  let s: number, d: number;
  const fresh = c.stability == null && !c.reps && !c.lapses;
  if (c.stability == null || c.difficulty == null) {
    if (!c.reps && !c.lapses) {
      // New card: first-grade starting values.
      s = W[g - 1];
      d = initD(g);
    } else {
      // Card scheduled before FSRS: treat its interval as its stability, difficulty from its ease.
      s = Math.max(0.5, c.interval);
      d = clampD(11 - c.ease * 3);
    }
  } else {
    s = c.stability;
    d = c.difficulty;
  }
  if (!fresh) {
    const t = c.last ? Math.max(0, daysBetween(c.last, now)) : c.interval;
    const r = recall(t, s);
    // Difficulty moves with the grade, then back a little toward its default.
    const d1 = d - W[6] * (g - 3) * ((10 - d) / 9);
    d = clampD(W[7] * initD(4) + (1 - W[7]) * d1);
    if (t < 1) s = s * Math.exp(W[17] * (g - 3 + W[18])); // seen again the same day
    else if (g === 1) s = Math.min(s, W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)));
    else s = s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * (g === 2 ? W[15] : 1) * (g === 4 ? W[16] : 1));
  }
  s = Math.max(0.1, s);
  if (g === 1) lapses += c.reps || c.lapses ? 1 : 0;
  reps = g === 1 ? 0 : reps + 1;
  // Again: back today (the review queue shows it again); otherwise when recall falls to 90% (= stability days).
  let interval = g === 1 ? 0 : Math.max(1, Math.min(36500, Math.round(s)));
  if (examDate && interval) {
    const left = daysBetween(now, examDate);
    // Before the exam: at most halfway there, so there's a second look. Exam day or after: no cap.
    if (left > 0) interval = Math.min(interval, Math.max(1, Math.floor(left / 2)));
  }
  const due = new Date(today);
  due.setDate(due.getDate() + interval);
  return { ...c, interval, reps, lapses, stability: s, difficulty: d, last: now, ease: c.ease, due: isoDate(due) };
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

/** Opens the flashcard review (all due cards, or one note's). App shows it. */
export const OPEN_REVIEW = "oc-open-review";
export const openReview = (pageId?: string) => window.dispatchEvent(new CustomEvent(OPEN_REVIEW, { detail: pageId ?? null }));

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
