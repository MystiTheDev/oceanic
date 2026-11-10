import { api } from "../data/api";
import { engine, nerida } from "./nerida";
import { isKnown } from "./spell/engine";

/* Nerida + PDFs: chat context from a PDF's extracted text, page-range summaries,
 * and the events the reader uses to reach the Nerida panel and to make notes. */

const BUDGET = 14_000; // same as notes: ~3.5k tokens of PDF text per question

/** Text of pages from..to (1-based, inclusive), each tagged with its page number. */
export async function pdfPages(docId: string, from = 1, to = Infinity) {
  const pages = await api.getPdfText(docId);
  return pages.map((text, i) => ({ page: i + 1, text: text.trim() })).filter((p) => p.page >= from && p.page <= to && p.text);
}

/** Share of a text's words that are real words: low for a poor scan's text layer ("35, 1S, So, Cem"). */
export function realWordShare(text: string) {
  const words = text.match(/[A-Za-z]{3,}/g) ?? [];
  if (words.length < 20) return 1;
  return words.filter((w) => isKnown(w)).length / words.length;
}
/** True when most of the text looks like OCR noise. */
export const looksGarbled = (text: string) => realWordShare(text) < 0.6;
export const GARBLED_NOTE = "\n\n*Note: this PDF's text looks garbled (probably a scan), so parts of this answer may be wrong. Check it against the PDF.*";
const GARBLED_HINT = "Some of this text is garbled scanner output. Ignore fragments that aren't real words or sentences, never quote them, and say so if you can't tell what a part means.";

/** The PDF's text for a question: whole if it fits, else the pages that best match it. */
export async function pdfContext(docId: string, name: string, question: string): Promise<{ text: string; parts: number; garbled: boolean }> {
  const pages = await pdfPages(docId);
  if (!pages.length) return { text: "", parts: 0, garbled: false };
  let chosen = pages;
  if (pages.reduce((s, p) => s + p.text.length, 0) > BUDGET) {
    const terms = new Set(question.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
    const score = (t: string) => (t.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => terms.has(w)).length / Math.sqrt(t.length + 50);
    let used = 0;
    // No useful words (e.g. "summarize this"): the first pages.
    const ranked = terms.size ? [...pages].sort((a, b) => score(b.text) - score(a.text)) : pages;
    const keep = new Set(ranked.filter((p) => (used += Math.min(p.text.length, 4000)) <= BUDGET));
    chosen = pages.filter((p) => keep.has(p));
  }
  const garbled = looksGarbled(chosen.map((p) => p.text).join(" "));
  const text = `PDF "${name}":${garbled ? ` (${GARBLED_HINT})` : ""}\n` + chosen.map((p) => `[page ${p.page}]\n${p.text.slice(0, 4000)}`).join("\n\n") + "\n(end of PDF)";
  return { text, parts: chosen.length, garbled };
}

async function ask(system: string, user: string, cap: number, onText?: (t: string) => void) {
  let out = "";
  await engine.chat(nerida.get().model, [{ role: "system", content: system }, { role: "user", content: user }], (t) => {
    out += t;
    onText?.(out);
    if (out.length > cap) void engine.stop();
  });
  return out.trim();
}

/** Summary of pages from..to as Markdown. Long ranges are summarized in parts, then combined. */
export async function summarizePdf(docId: string, from: number, to: number, detailed: boolean, onProgress: (label: string, text: string) => void): Promise<string> {
  const pages = await pdfPages(docId, from, to);
  if (!pages.length) throw new Error("No text found on those pages. Scanned PDFs (pictures of text) can't be summarized yet.");
  // Parts of ~6000 characters, never splitting a page.
  const parts: { from: number; to: number; text: string }[] = [];
  for (const p of pages) {
    const last = parts[parts.length - 1];
    if (last && last.text.length + p.text.length < 6000) (last.text += "\n\n" + p.text), (last.to = p.page);
    else parts.push({ from: p.page, to: p.page, text: p.text.slice(0, 6000) });
  }
  const garbled = looksGarbled(pages.map((p) => p.text).join(" "));
  const SYS = "You are Nerida, a study assistant. You summarize study material accurately, using only what the text says." + (garbled ? " " + GARBLED_HINT : "");
  const tail = garbled ? GARBLED_NOTE : "";
  const bullets = detailed ? "5 to 8" : "3 to 5";
  const notes: string[] = [];
  for (const [i, part] of parts.entries()) {
    onProgress(parts.length > 1 ? `Reading pages ${part.from}–${part.to} (${i + 1} of ${parts.length})` : "Summarizing", notes.join("\n\n"));
    const s = await ask(SYS, `Summarize this text in ${bullets} short bullet points ("- "). Only facts from the text. No intro.\n\n${part.text}`, 1500);
    notes.push(parts.length > 1 ? `## Pages ${part.from}–${part.to}\n${s}` : s);
  }
  if (detailed || parts.length === 1) return notes.join("\n\n") + tail;
  onProgress("Combining", notes.join("\n\n"));
  return (await ask(SYS, `Combine these notes into one summary of 5 to 8 bullet points ("- "), most important first. No intro.\n\n${notes.join("\n\n")}`, 2000, (t) => onProgress("Combining", t))) + tail;
}

/* ---------------------------------------------------------------- events */
/** Opens the Nerida panel and puts text in its box; `send` sends it at once. */
export const NERIDA_ASK = "oc-nerida-ask";
export type AskDetail = { text: string; send: boolean };
export const askNerida = (d: AskDetail) => {
  nerida.set({ open: true });
  // Let the panel mount first when it was closed.
  setTimeout(() => window.dispatchEvent(new CustomEvent(NERIDA_ASK, { detail: d })), 50);
};

/** App makes (or, with `reuse`, finds by title) a top-level note; `done` gets its id. */
export const NERIDA_NOTE = "oc-nerida-note";
export type NoteRequest = { title: string; markdown?: string; reuse?: boolean; open?: boolean; done: (id: string) => void };
export const neridaNote = (title: string, markdown?: string, reuse = false, open = false) =>
  new Promise<string>((done) => window.dispatchEvent(new CustomEvent(NERIDA_NOTE, { detail: { title, markdown, reuse, open, done } satisfies NoteRequest })));
