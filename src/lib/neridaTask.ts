/* Nerida → calendar: spots "essay due Friday"-style messages and works out the date itself
 * (small models get dates wrong). Nerida shows a card; nothing is saved until you confirm. */

export type TaskDraft = { title: string; date: string };
export type TaskRequest = { title: string; dueDate: string; tag: string | null; target: "new" | "current"; pageId: string | null };
export const NERIDA_TASK = "oc-nerida-task";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10 };

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const add = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

type Hit = { date: Date; match: string };
const MON = `(${MONTHS.join("|")})[a-z]*\\.?`;
const DAY = `(${DAYS.map((d) => d.slice(0, 3)).join("|")})[a-z]*`;

/** First date phrase in the text, relative to `now`. */
export function findDate(text: string, now = new Date()): Hit | null {
  const t = text.toLowerCase();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let m: RegExpMatchArray | null;
  if ((m = t.match(/\b(today|tonight)\b/))) return { date: today, match: m[0] };
  if ((m = t.match(/\b(the day after tomorrow)\b/))) return { date: add(today, 2), match: m[0] };
  if ((m = t.match(/\b(tomorrow|tmrw|tmr)\b/))) return { date: add(today, 1), match: m[0] };
  if ((m = t.match(/\bin (\d+|a|an|one|two|three|four|five|six|seven|ten) (day|week)s?\b/))) {
    const n = NUM[m[1]] ?? Number(m[1]);
    return { date: add(today, m[2] === "week" ? n * 7 : n), match: m[0] };
  }
  if ((m = t.match(/\bnext week\b/))) return { date: add(today, 7), match: m[0] };
  // Weekday: the coming one. "next Friday" skips a week only when that day is 3 or fewer days away.
  if ((m = t.match(new RegExp(`\\b(?:(next|this|on|by)\\s+)?${DAY}\\b`)))) {
    const want = DAYS.findIndex((d) => d.startsWith(m![2]));
    let n = (want - today.getDay() + 7) % 7 || 7;
    if (m[1] === "next" && n <= 3) n += 7;
    return { date: add(today, n), match: m[0] };
  }
  // 14 Nov, 14th of November, Nov 14
  const year = (mo: number, d: number) => (new Date(today.getFullYear(), mo, d) < today ? today.getFullYear() + 1 : today.getFullYear());
  if ((m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON}`)))) {
    const mo = MONTHS.indexOf(m[2]), d = Number(m[1]);
    return { date: new Date(year(mo, d), mo, d), match: m[0] };
  }
  if ((m = t.match(new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`)))) {
    const mo = MONTHS.indexOf(m[1]), d = Number(m[2]);
    return { date: new Date(year(mo, d), mo, d), match: m[0] };
  }
  // 14/11 or 14/11/2026 (day first)
  if ((m = t.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/))) {
    const d = Number(m[1]), mo = Number(m[2]) - 1;
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year(mo, d);
    return { date: new Date(y, mo, d), match: m[0] };
  }
  return null;
}

const CUE = /\b(due|deadline|remind|add|schedule|submit|hand in|exam|test|quiz|essay|homework|assignment|project|revise|revision|study|presentation|appointment|meeting|practice|lab|coursework|task|todo|to-do|calendar)\b/i;
const QUESTION = /^\s*(what|which|when|who|why|how|is|are|do|does|did|can|could|should|would|will)\b/i;

/** A task + date in the message, or null for a normal chat message. */
export function detectTask(text: string, now = new Date()): TaskDraft | null {
  if (text.length > 160 || !CUE.test(text)) return null;
  // Questions ("what's due tomorrow?") are answered, not turned into tasks, unless they ask to add/remind.
  if ((QUESTION.test(text) || text.trim().endsWith("?")) && !/\b(add|remind|schedule|put)\b/i.test(text)) return null;
  const hit = findDate(text, now);
  if (!hit) return null;
  return { title: titleFrom(text, hit.match), date: ymd(hit.date) };
}

/** "remind me to revise chemistry on Monday" → "Revise chemistry". */
function titleFrom(text: string, dateMatch: string) {
  let t = text.replace(new RegExp(dateMatch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");
  t = t
    .replace(/^\s*(can you |could you |please |pls |nerida,? )+/i, "")
    .replace(/^\s*(remind me (to|about|of)|add( a| an)?( task)?( for)?|schedule|put|create( a| an)?( task)?( for)?|set( a)?( task| reminder)?( for)?|i have( a| an)?|there'?s( a| an)?|my)\s+/i, "")
    .replace(/\b(to|in|on|into) (my |the )?(calendar|planner|tasks?)\b/gi, " ")
    .replace(/\b(is |are )?(due|deadline)( on| by| is)?\b/gi, " ")
    .replace(/[\s.!?,]+$/, "")
    .replace(/\s+(on|by|for|at|this|next|the)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  t = t.replace(/^(a|an|the|my)\s+/i, "");
  return t ? t[0].toUpperCase() + t.slice(1) : "New task";
}

/** "Fri 14 Nov" */
export const prettyDate = (s: string) =>
  new Date(`${s}T00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
