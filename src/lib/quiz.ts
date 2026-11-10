import { useSyncExternalStore } from "react";
import type { Card } from "./srs";

/* ------------------------------------------------------------ history */
export type TestRecord = { id: string; date: string; title: string; score: number; total: number; secs: number; leaves: number };
const KEY = "studyTests";
let history: TestRecord[] = JSON.parse(localStorage.getItem(KEY) ?? "[]");
const subs = new Set<() => void>();
export function addTestRecord(r: TestRecord) {
  history = [r, ...history].slice(0, 50);
  localStorage.setItem(KEY, JSON.stringify(history));
  subs.forEach((f) => f());
}
export const useTestHistory = () => useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => history);

/* Test generator: turns flashcards into multiple-choice and true/false questions.
 * Kept separate from the UI so another source (e.g. AI) can produce the same Question shape later. */

export type QuestionType = "mcq" | "tf";
export type Question = {
  id: string;
  cardId: string;
  type: QuestionType;
  prompt: string;
  /** mcq: 4 answers; tf: the single statement shown with the prompt. */
  options: string[];
  /** mcq: index into options; tf: 1 = true, 0 = false. */
  correct: number;
  /** The card's real answer, for the mistakes review. */
  answer: string;
};

const answerOf = (c: Card) => (c.cloze ? (c.cloze.match(/\{\{(.+?)\}\}/)?.[1] ?? c.a) : c.a).trim();
const shuffle = <T,>(a: T[]) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

/** Wrong answers from other cards, same note first so they look believable. */
function distractors(card: Card, pool: Card[], n: number) {
  const right = answerOf(card).toLowerCase();
  const seen = new Set([right]);
  const out: string[] = [];
  const others = [...shuffle(pool.filter((c) => c.pageId === card.pageId)), ...shuffle(pool.filter((c) => c.pageId !== card.pageId))];
  for (const c of others) {
    const a = answerOf(c);
    if (a && !seen.has(a.toLowerCase())) (seen.add(a.toLowerCase()), out.push(a));
    if (out.length === n) break;
  }
  return out;
}

/** Build `count` questions from `cards` (distractors may come from `pool`, e.g. all cards). */
export function buildQuiz(cards: Card[], count: number, types: QuestionType[], pool: Card[] = cards): Question[] {
  return shuffle(cards.filter((c) => answerOf(c))).slice(0, count).map((c, i) => {
    const answer = answerOf(c);
    const wrong = distractors(c, pool, 3);
    const type: QuestionType = types.includes("mcq") && wrong.length === 3 && (!types.includes("tf") || Math.random() < 0.6) ? "mcq" : "tf";
    if (type === "mcq") {
      const options = shuffle([answer, ...wrong]);
      return { id: `${c.id}-${i}`, cardId: c.id, type, prompt: c.q, options, correct: options.indexOf(answer), answer };
    }
    const truth = !wrong.length || Math.random() < 0.5;
    return { id: `${c.id}-${i}`, cardId: c.id, type, prompt: c.q, options: [truth ? answer : wrong[0]], correct: truth ? 1 : 0, answer };
  });
}

/** answers[i] = chosen index (mcq) or 1/0 (tf); undefined = skipped. */
export const score = (qs: Question[], answers: (number | undefined)[]) => qs.filter((q, i) => answers[i] === q.correct).length;
