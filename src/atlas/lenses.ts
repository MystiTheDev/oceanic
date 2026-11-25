/**
 * Atlas lenses: the reasons to open Atlas. Pure helpers here (no React):
 * study queue, exam maps, suggested connections and cleanup lists.
 */
import { api, type CanvasEdge, type Concept, type LinkEdge } from "../data/api";
import type { PageMeta } from "../data/workspace";
import { prerequisites } from "../data/atlas";
import { similarity, semanticReady, indexChunks } from "../lib/semantic";

export type Lens = "study" | "exam" | "suggest" | "cleanup";

/** Lens the next Atlas mount should open (set by Home, notes and nudges). */
export let pendingLens: Lens | null = null;
export const setPendingLens = (l: Lens | null) => (pendingLens = l);
/** Fired to open Atlas on a lens: detail = Lens. */
export const OPEN_LENS = "oc-open-lens";
export const openLens = (l: Lens) => (setPendingLens(l), window.dispatchEvent(new CustomEvent(OPEN_LENS, { detail: l })));

/* ---------------------------------------------------------------- study */
export type StudyQueue = { review: Concept[]; learning: Concept[]; ready: Concept[]; blocked: Concept[]; done: number };
/** Manual learning states → what to look at now. "Ready" = new, and everything it depends on is understood. */
export function studyQueue(concepts: Concept[], edges: CanvasEdge[]): StudyQueue {
  const by = new Map(concepts.map((c) => [c.id, c]));
  const known = (id: string) => ["understood", "mastered"].includes(by.get(id)?.state ?? "understood");
  const q: StudyQueue = { review: [], learning: [], ready: [], blocked: [], done: 0 };
  for (const c of concepts) {
    if (c.state === "review") q.review.push(c);
    else if (c.state === "learning") q.learning.push(c);
    else if (c.state === "unexplored") (prerequisites(edges, c.id).order.every(known) ? q.ready : q.blocked).push(c);
    else q.done++;
  }
  return q;
}

/* ---------------------------------------------------------------- exam maps */
/** Saved members per map key ("exam:<pageId>" or "tag:<name>"). */
export type ExamMaps = Record<string, string[]>;
const MAPS_KEY = "atlasExamMaps";
export const loadMaps = async (): Promise<ExamMaps> => {
  try { return JSON.parse((await api.getSettings())[MAPS_KEY] ?? "{}"); } catch { return {}; }
};
export const saveMaps = (m: ExamMaps) => api.setSetting(MAPS_KEY, JSON.stringify(m)).catch(() => {});

/** Notes the map should probably include: tagged with the subject (or the exam's own tags), or linked to the exam page. */
export function recommended(key: string, pages: PageMeta[], links: LinkEdge[], members: string[]): PageMeta[] {
  const have = new Set(members);
  let tags: string[] = [];
  const linked = new Set<string>();
  if (key.startsWith("tag:")) tags = [key.slice(4)];
  else {
    const id = key.slice(5);
    tags = (pages.find((p) => p.id === id)?.tags ?? []).filter((t) => t !== "Exam");
    for (const l of links) if (l.sourceId === id) linked.add(l.targetId); else if (l.targetId === id) linked.add(l.sourceId);
  }
  const lower = tags.map((t) => t.toLowerCase());
  return pages.filter((p) => !have.has(p.id) && !key.endsWith(p.id) && (linked.has(p.id) || (p.tags ?? []).some((t) => lower.includes(t.toLowerCase()))));
}

/* ---------------------------------------------------------------- suggestions */
export type Suggestion = { a: string; b: string; score: number; why: string[]; source: "words" | "meaning" | "tags" | "nerida" };
const DISMISS_KEY = "atlasDismissedLinks";
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const loadDismissed = async (): Promise<Set<string>> => {
  try { return new Set(JSON.parse((await api.getSettings())[DISMISS_KEY] ?? "[]")); } catch { return new Set(); }
};
export const saveDismissed = (s: Set<string>) => api.setSetting(DISMISS_KEY, JSON.stringify([...s].slice(-500))).catch(() => {});

const STOP = new Set("about above after again against because before being below between could doing during every further having himself herself itself might other ourselves should their theirs themselves there these those through under until which while would yours yourself where what when with from into this that than them they have will your more most some such only very just also each both many much over same then there here were been does make made like used using uses notes note page pages title untitled".split(" "));
const words = (t: string) => t.toLowerCase().match(/[\p{L}][\p{L}\p{N}-]{4,}/gu)?.filter((w) => !STOP.has(w)) ?? [];

/**
 * Pairs of notes that look related but aren't connected: shared rare words (always),
 * shared tags, and meaning match when the local search model is ready. Max 15.
 */
export async function suggest(pages: PageMeta[], connected: Set<string>, dismissed: Set<string>): Promise<Suggestion[]> {
  const list = [...pages].sort((x, y) => (y.updatedAt ?? "").localeCompare(x.updatedAt ?? "")).slice(0, 80);
  if (list.length < 2) return [];
  const prev = new Map((await api.getPagePreviews(list.map((p) => p.id), 2000).catch(() => [])).map((p) => [p.id, p.text]));
  const docs = list.map((p) => new Set(words(`${p.title} ${p.title} ${prev.get(p.id) ?? ""}`)));
  const df = new Map<string, number>();
  for (const d of docs) for (const w of d) df.set(w, (df.get(w) ?? 0) + 1);
  const n = list.length;
  const out = new Map<string, Suggestion>();
  const put = (i: number, j: number, score: number, why: string[], source: Suggestion["source"]) => {
    const k = pairKey(list[i].id, list[j].id);
    if (connected.has(k) || dismissed.has(k)) return;
    const s = out.get(k);
    if (s) (s.score += score, s.why.push(...why.filter((w) => !s.why.includes(w))));
    else out.set(k, { a: list[i].id, b: list[j].id, score, why, source });
  };
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      // Rare shared words (appear in under a third of the notes, at least twice overall).
      const shared = [...docs[i]].filter((w) => docs[j].has(w) && (df.get(w) ?? 0) <= Math.max(2, n / 3));
      const score = shared.reduce((s, w) => s + Math.log(n / (df.get(w) ?? 1)), 0);
      if (shared.length >= 2 && score > 3) put(i, j, score / 4, shared.sort((a, b) => (df.get(a) ?? 0) - (df.get(b) ?? 0)).slice(0, 3), "words");
      const tags = (list[i].tags ?? []).filter((t) => (list[j].tags ?? []).includes(t) && t !== "Exam" && t !== "Assignment");
      if (tags.length) put(i, j, tags.length * 1.5, tags.map((t) => `#${t}`), "tags");
    }
  // Meaning match, when the search model is on disk.
  if (await semanticReady().catch(() => false)) {
    const texts = list.map((p) => `${p.title}\n${(prev.get(p.id) ?? "").slice(0, 800)}`);
    await indexChunks(texts).catch(() => {});
    for (let i = 0; i < Math.min(n, 30); i++) {
      const sims = await similarity(texts[i], texts).catch(() => null);
      sims?.forEach((s, j) => j > i && s > 0.72 && put(i, j, (s - 0.6) * 12, ["similar meaning"], "meaning"));
    }
  }
  return [...out.values()].sort((x, y) => y.score - x.score).slice(0, 15);
}

/* ---------------------------------------------------------------- cleanup */
const DAY = 864e5;
export type Cleanup = { unlinked: PageMeta[]; untagged: PageMeta[]; stale: PageMeta[] };
export function cleanup(pages: PageMeta[], degree: (id: string) => number): Cleanup {
  const old = Date.now() - 90 * DAY;
  const hasKids = new Set(pages.map((p) => p.parentId).filter(Boolean));
  return {
    unlinked: pages.filter((p) => degree(p.id) === 0 && !p.parentId && !hasKids.has(p.id)),
    untagged: pages.filter((p) => !(p.tags ?? []).length),
    stale: pages.filter((p) => p.updatedAt && Date.parse(p.updatedAt) < old),
  };
}
