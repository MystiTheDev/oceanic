import { engine, nerida } from "./nerida";
import { isKnown, suggestionsFor } from "./spell/engine";

/* Nerida edits selected text (Notes, Docs): the popup previews the result, then the
 * editor that opened it replaces the selection or inserts below it. */

export const NERIDA_EDIT = "oc-nerida-edit";
export type EditAction = "improve" | "grammar" | "custom";
export type NeridaEditDetail = {
  text: string;
  x: number;
  y: number;
  replace: (text: string) => void;
  insertBelow?: (text: string) => void;
  /** Continue writing: `text` is what comes before the caret; Nerida starts at once and `replace` inserts. */
  continue?: boolean;
};

export const openNeridaEdit = (d: NeridaEditDetail) => window.dispatchEvent(new CustomEvent(NERIDA_EDIT, { detail: d }));

const TASK: Record<Exclude<EditAction, "custom">, string> = {
  improve: "Rewrite this text so it is clearer and better worded. Keep the meaning, the language and roughly the length.",
  grammar: "Fix only spelling, grammar and punctuation in this text. Change nothing else.",
};

const prompt = (task: string, text: string) => `${task}\nOutput only the new text: no intro, no quotes, no notes.\n\nText:\n${text}`;

/** 1–3 words: word-level menu (Fix spelling, Synonyms) instead of Improve writing. */
export const isShort = (text: string) => text.trim().split(/\s+/).length <= 3;

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}']{3,}/gu) ?? [];
/** Tiny models sometimes write about something else entirely: the result must reuse some of the original words. */
function onTopic(src: string, out: string) {
  const a = new Set(words(src));
  if (a.size < 3) return true;
  const b = new Set(words(out));
  return [...a].filter((w) => b.has(w)).length / a.size >= 0.3;
}

/** Streams the edited text; resolves with the cleaned result. */
export async function runEdit(action: EditAction, text: string, custom: string, onText: (t: string) => void): Promise<string> {
  const model = nerida.get().model;
  const task = action === "custom" ? `Do this to the text: ${custom.trim()}` : TASK[action];
  let out = "";
  await engine.chat(
    model,
    [
      { role: "system", content: "You are Nerida, a writing assistant. You edit the user's text and reply with only the edited text." },
      { role: "user", content: prompt(task, text) },
    ],
    (t) => {
      out += t;
      onText(clean(out));
      if (out.length > text.length * 4 + 800) void engine.stop(); // runaway output
    },
  );
  const r = clean(out);
  // Custom instructions (e.g. translate) may change every word, so only Improve / Fix are checked.
  if (action !== "custom" && !onTopic(text, r)) throw new Error("Nerida went off-topic. Try again.");
  return r;
}

/** Spelling fix for a few words: the offline spellchecker, instant and exact. */
export function fixSpelling(text: string) {
  return text.replace(/[A-Za-z][A-Za-z'’]*/g, (w) => (isKnown(w) ? w : suggestionsFor(w)[0] ?? w));
}

/** Up to 5 alternatives for a word or short phrase. */
export async function synonyms(text: string): Promise<string[]> {
  let out = "";
  await engine.chat(
    nerida.get().model,
    [
      { role: "system", content: "You give synonyms. Reply with only a comma-separated list." },
      { role: "user", content: `Give 5 words or short phrases that mean the same as "${text.trim()}". Reply with only the list, separated by commas.` },
    ],
    (t) => {
      out += t;
      if (out.length > 300) void engine.stop();
    },
  );
  const self = text.trim().toLowerCase();
  const list = clean(out)
    .split(/[,\n]|\d+\.\s/)
    .map((x) => x.replace(/^[\s\-*"“]+|[\s."”]+$/g, ""))
    .filter((x) => x && x.length <= 40 && x.split(/\s+/).length <= 4 && x.toLowerCase() !== self);
  // Match the original's capitalisation.
  const cap = /^[A-Z]/.test(text.trim());
  return [...new Set(list)].slice(0, 5).map((x) => (cap ? x[0].toUpperCase() + x.slice(1) : x.toLowerCase()));
}

/** Strips chatter small models add anyway ("Here is the rewritten text:", wrapping quotes). */
const clean = (s: string) =>
  s
    .replace(/^\s*(here(?:'s| is)[^\n:]*:|sure[^\n:]*:|rewritten text:|corrected text:)\s*/i, "")
    .replace(/^\s*["“](.*)["”]\s*$/s, "$1")
    .trim();

export const stopEdit = () => void engine.stop();

/* ------------------------------------------------------- Docs / Notes extras */
const last = (s: string, n: number) => (s.length > n ? s.slice(-n) : s);

/** Continue writing: the next paragraph after the text before the caret. */
export async function runContinue(before: string, onText: (t: string) => void): Promise<string> {
  let out = "";
  await engine.chat(
    nerida.get().model,
    [
      { role: "system", content: "You are Nerida, a writing assistant. You continue the user's writing in the same voice, tense and language." },
      { role: "user", content: `Here is my writing so far:\n\n${last(before, 3000)}\n\nWrite the next paragraph only (3 to 5 sentences). Don't repeat what I wrote. Output only the paragraph.` },
    ],
    (t) => {
      out += t;
      onText(clean(out));
      if (out.length > 1500) void engine.stop();
    },
  );
  return clean(out);
}

export type EssayType = "argumentative" | "explanatory" | "compare and contrast" | "narrative" | "report";
export type OutlineOpts = { topic: string; type: EssayType; paragraphs: number; points: string };

/** Essay outline as Markdown: "## Introduction", "## <body heading>" with "- " points, "## Conclusion". */
export async function runOutline(o: OutlineOpts, onText: (t: string) => void): Promise<string> {
  let out = "";
  const body = Array.from({ length: o.paragraphs }, (_, i) => `## <heading for body paragraph ${i + 1}>\n- <point>\n- <point>`).join("\n");
  await engine.chat(
    nerida.get().model,
    [
      { role: "system", content: "You are Nerida, a study assistant. You write clear essay outlines in Markdown." },
      {
        role: "user",
        content:
          `Write an outline for a ${o.type} essay on: ${o.topic.trim()}\n` +
          (o.points.trim() ? `Build it around my own ideas: ${o.points.trim()}\n` : "") +
          `Use exactly this shape, with ${o.paragraphs} body sections, short points, and no other text:\n## Introduction\n- <hook>\n- <thesis>\n${body}\n## Conclusion\n- <point>`,
      },
    ],
    (t) => {
      out += t;
      onText(clean(out));
      if (out.length > 3000) void engine.stop();
    },
  );
  return clean(out);
}

/** Essay feedback: clarity, argument, grammar — a Markdown list per area. */
export async function runFeedback(text: string, onText: (t: string) => void): Promise<string> {
  let out = "";
  await engine.chat(
    nerida.get().model,
    [
      { role: "system", content: "You are Nerida, a helpful writing tutor. Give specific, kind, honest feedback. Quote the exact words you mean." },
      {
        role: "user",
        content:
          `Give feedback on my essay below under exactly these three headings, 2 to 4 bullet points each:\n## Clarity\n## Argument\n## Grammar & spelling\n` +
          `For each point, quote the words from my essay and say how to fix them. If an area has no problems, say so in one bullet.\n\nMy essay:\n${text.slice(0, 12000)}`,
      },
    ],
    (t) => {
      out += t;
      onText(clean(out));
      if (out.length > 4000) void engine.stop();
    },
  );
  return clean(out);
}

/** Minimal Markdown → HTML for the Docs editor (headings, bullets, bold, paragraphs). */
export function mdToHtml(md: string) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const out: string[] = [];
  let list = false;
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*[-*]\s+(.*)/);
    if (li) {
      if (!list) out.push("<ul>"), (list = true);
      out.push(`<li><p>${esc(li[1])}</p></li>`);
      continue;
    }
    if (list) out.push("</ul>"), (list = false);
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) out.push(`<h${h[1].length + 1}>${esc(h[2])}</h${h[1].length + 1}>`);
    else if (line.trim()) out.push(`<p>${esc(line)}</p>`);
  }
  if (list) out.push("</ul>");
  return out.join("");
}
