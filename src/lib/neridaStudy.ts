import { api } from "../data/api";
import { builtin, docText, engine, nerida, relatedNotes } from "./nerida";
import type { Question } from "./quiz";

/* Nerida → study material, grounded by construction.
 * Tested on Nerida Lite (then Qwen2.5-0.5B; now Qwen3.5-0.8B): asked for a whole quiz it invents facts and loops.
 * So the model gets ONE note sentence at a time and writes a question whose answer is
 * a phrase copied from that sentence; answers not found in the sentence are dropped.
 * Cloze cards, true/false and multiple-choice options are then built by the app
 * from those real sentences and answers. */

export type Difficulty = "easy" | "medium" | "hard";
export type CardStyle = "qa" | "cloze";
export type GenCard = { id: string; text: string; pageId: string };
export type SourceText = { pageId: string; title: string; text: string };
export type AiQuestion = Question & { source: string; pageId: string };
type Fact = { q: string; a: string; sentence: string; pageId: string };

const LEVEL: Record<Difficulty, string> = {
  easy: "a basic fact or definition",
  medium: "the key idea",
  hard: "the most important detail (what, where, which, how)",
};

/* ---------------------------------------------------------------- source */
/** Note text for generation: the picked notes, optionally with their sub-pages and linked notes. */
export async function gatherText(pageIds: string[], includeRelated: boolean): Promise<SourceText[]> {
  const ids = new Set(pageIds);
  if (includeRelated) for (const id of pageIds) for (const n of await relatedNotes(id)) if (n.why !== "backlink") ids.add(n.id);
  const out: SourceText[] = [];
  for (const id of ids) {
    const p = await api.getPage(id);
    if (p) out.push({ pageId: id, title: p.title || "Untitled", text: docText(p.content) });
  }
  return out.filter((s) => s.text.trim());
}

/** Study-worthy sentences: skips headings, checklist items, existing flashcards and fragments. */
function sentences(src: SourceText[], level: Difficulty) {
  const out: { s: string; pageId: string }[] = [];
  for (const { text, pageId } of src)
    for (const line of text.split("\n")) {
      if (/^\s*Heading: |\[(?:not )?done\]$|::|\?\?|\{\{/.test(line)) continue;
      for (const raw of line.replace(/^\s*- /, "").split(/(?<=[.!?])\s+(?=[A-Z0-9])/)) {
        const s = raw.trim();
        const n = s.split(/\s+/).length;
        if (n >= (level === "hard" ? 8 : 5) && n <= 45) out.push({ s, pageId });
      }
    }
  return out;
}

const shuffle = <T,>(a: T[]) => a.map((v) => [Math.random(), v] as const).sort((x, y) => x[0] - y[0]).map(([, v]) => v);
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------- model */
let stopped = false;
export const stopGenerating = () => ((stopped = true), void engine.stop());

const ASK = (s: string, level: Difficulty) =>
  `Sentence: ${s}\nWrite one question about ${LEVEL[level]} whose answer is a short phrase copied exactly from the sentence. Output one line:\nQ: <question> || A: <phrase from the sentence>`;
const EXAMPLES = [
  [ASK("Ribosomes make proteins.", "medium"), "Q: What do ribosomes make? || A: proteins"],
  [ASK("Mitochondria produce ATP, the energy currency of the cell.", "medium"), "Q: What is the energy currency of the cell? || A: ATP"],
];

/** One grounded question/answer from one sentence, or null if the model's answer isn't in the sentence. */
async function factFrom(s: string, pageId: string, level: Difficulty): Promise<Fact | null> {
  const model = nerida.get().model;
  let out = "";
  await engine.chat(
    model,
    [
      { role: "system", content: "You write short study questions from a sentence. Output only the requested line." },
      ...(builtin(model) ? EXAMPLES.flatMap(([u, a]) => [{ role: "user", content: u }, { role: "assistant", content: a }]) : []),
      { role: "user", content: ASK(s, level) },
    ],
    (t) => {
      out += t;
      if (out.length > 400) void engine.stop(); // runaway output
    },
  );
  const m = out.match(/Q:\s*(.+?)\s*\|\|\s*A:\s*(.+)/);
  if (!m) return null;
  const q = m[1].trim();
  const a = m[2].trim().replace(/[.;,]$/, "");
  // Grounding: the answer must be a real, short part of the sentence, and not given away by the question.
  if (!norm(s).includes(norm(a)) || norm(a).length > norm(s).length * 0.6 || norm(q).includes(norm(a))) return null;
  return { q, a, sentence: s, pageId };
}

/** Streams grounded facts until `want` are found or sentences run out. */
async function facts(src: SourceText[], want: number, level: Difficulty, onFact: (f: Fact) => void, skip = new Set<string>()) {
  stopped = false;
  let made = 0;
  for (const { s, pageId } of shuffle(sentences(src, level))) {
    if (stopped || made >= want) break;
    const f = await factFrom(s, pageId, level).catch(() => null);
    if (!f || skip.has(f.q.toLowerCase())) continue;
    skip.add(f.q.toLowerCase());
    made++;
    onFact(f);
  }
  return made;
}

/* ----------------------------------------------------------- flashcards */
/** Generates flashcards (Q :: A and/or cloze); `onCard` gets each as it's ready. */
export function generateCards(src: SourceText[], count: number, styles: CardStyle[], level: Difficulty, onCard: (c: GenCard) => void, existing: string[] = []) {
  let i = 0;
  return facts(src, count, level, (f) => {
    const cloze = styles.includes("cloze") && (!styles.includes("qa") || i++ % 2 === 1);
    const text = cloze ? f.sentence.replace(new RegExp(f.a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), (m) => `{{${m}}}`) : `${f.q} :: ${f.a}`;
    onCard({ id: crypto.randomUUID(), text, pageId: f.pageId });
  }, new Set(existing.map((q) => q.toLowerCase())));
}

/* ---------------------------------------------------------------- quiz */
/** Generates test questions strictly from the notes. Facts stream in via `onProgress`; the
 *  questions are built at the end (multiple-choice options come from the other answers). */
export async function generateQuestions(src: SourceText[], count: number, types: ("mcq" | "tf")[], level: Difficulty, onProgress: (n: number) => void): Promise<AiQuestion[]> {
  const all: Fact[] = [];
  await facts(src, count, level, (f) => (all.push(f), onProgress(all.length)));
  const answers = [...new Set(all.map((f) => f.a))];
  return all.map((f, i) => {
    const id = `ai-${crypto.randomUUID()}`;
    const base = { id, cardId: id, source: f.sentence, pageId: f.pageId, answer: f.a };
    const others = shuffle(answers.filter((a) => norm(a) !== norm(f.a)));
    const mcq = types.includes("mcq") && others.length >= 3 && (!types.includes("tf") || i % 3 !== 2);
    if (mcq) {
      const options = shuffle([f.a, ...others.slice(0, 3)]);
      return { ...base, type: "mcq", prompt: f.q, options, correct: options.indexOf(f.a) } as AiQuestion;
    }
    // True/false: the real sentence, or the sentence with another answer swapped in.
    // Swap in an answer of the same shape ("in the stroma" for "in the thylakoid membranes", not "glucose").
    const head = (a: string) => (/^(in|on|at|by|from|into|to|with|for|of)\b/i.test(a) ? a.split(" ")[0].toLowerCase() : "");
    const swap = others.find((a) => head(a) === head(f.a));
    const truth = !swap || Math.random() < 0.5;
    const statement = truth ? f.sentence : f.sentence.replace(new RegExp(f.a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), swap);
    return { ...base, type: "tf", prompt: statement, options: [""], correct: truth ? 1 : 0, answer: truth ? "True" : `False: ${f.sentence}` } as AiQuestion;
  });
}

/* ----------------------------------------------------------- saving */
/** Puts cards into the note's "Flashcards" toggle. The open editor handles it (and sets
 *  `handled`); otherwise App edits the stored document. */
export type SaveCardsDetail = { pageId: string; cards: string[]; handled?: boolean };
export const saveCards = (pageId: string, cards: string[]) =>
  window.dispatchEvent(new CustomEvent<SaveCardsDetail>("oc-nerida-cards", { detail: { pageId, cards } }));

type B = { type?: string; content?: unknown; children?: B[] };
const plain = (b: B) => (Array.isArray(b.content) ? (b.content as { text?: string }[]).map((n) => n.text ?? "").join("") : typeof b.content === "string" ? b.content : "");
const question = (t: string) => t.split(" :: ")[0].trim().toLowerCase();

/** Document with `cards` added to its "Flashcards" toggle (created at the end if missing); duplicates skipped. */
export function withCards<T extends B>(doc: T[], cards: string[]): T[] {
  const i = doc.findIndex((b) => b.type === "toggleListItem" && plain(b).trim() === "Flashcards");
  const have = new Set((i >= 0 ? doc[i].children ?? [] : []).map((c) => question(plain(c))));
  const items = cards.filter((c) => !have.has(question(c))).map((t) => ({ type: "bulletListItem", content: t, children: [] }));
  if (!items.length) return doc;
  if (i < 0) return [...doc, { type: "toggleListItem", content: "Flashcards", children: items } as unknown as T];
  return doc.map((b, j) => (j === i ? { ...b, children: [...(b.children ?? []), ...items] } : b));
}
