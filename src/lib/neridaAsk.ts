import type { PageMeta } from "../data/workspace";
import type { AskAnswers, AskQuestion } from "../components/NeridaAskBox";

/* Clarifying questions before Nerida's note actions (create / delete / rename / read).
 * Fixed templates (reliable on the small built-in model); answers go into the request as "User choices". */

export type AskMode = "smart" | "always" | "off";
const KEY = "oc-nerida-ask";
export const getAskMode = (): AskMode => {
  try { const v = localStorage.getItem(KEY); return v === "always" || v === "off" ? v : "smart"; } catch { return "smart"; }
};
export const setAskMode = (m: AskMode) => { try { localStorage.setItem(KEY, m); } catch { /* ignore */ } };

type Intent = "create" | "delete" | "rename" | "read";
export type AskPlan = { intent: Intent; title: string; questions: AskQuestion[]; ids: Record<string, string> };

const INTENTS: [Intent, RegExp][] = [
  ["create", /\b(make|create|write|new|start)\b.{0,40}\b(note|page)s?\b/i],
  ["delete", /\b(delete|remove|trash|get rid of)\b/i],
  ["rename", /\brename\b/i],
  ["read", /\b(read|summari[sz]e|what('s| is| does)|explain|tell me about)\b.{0,40}\b(note|page)s?\b/i],
];
const name = (p: PageMeta) => p.title?.trim() || "Untitled";
const words = (s: string) => s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
const STOP = new Set(["the", "and", "note", "notes", "page", "pages", "delete", "remove", "trash", "rename", "read", "make", "create", "about", "summarize", "summarise", "what", "does", "this", "that", "with", "from", "please", "old", "all", "tell"]);

/** Top notes matching the request words; recent first when nothing matches. */
function matches(text: string, pages: PageMeta[], n = 3) {
  const w = words(text).filter((x) => !STOP.has(x));
  const scored = pages.map((p) => ({ p, s: w.filter((x) => name(p).toLowerCase().includes(x)).length }));
  const hit = scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  const list = hit.length ? hit.map((x) => x.p) : [...pages].sort((a, b) => +new Date(b.updatedAt ?? 0) - +new Date(a.updatedAt ?? 0));
  return list.slice(0, n);
}

export function planAsk(text: string, allPages: PageMeta[], openId: string | null): AskPlan | null {
  const mode = getAskMode();
  if (mode === "off") return null;
  const intent = INTENTS.find(([, r]) => r.test(text))?.[0];
  if (!intent) return null;
  const always = mode === "always";
  const pages = allPages.filter((p) => !p.trashedAt);
  const ids: Record<string, string> = {};
  const qs: AskQuestion[] = [];
  const named = pages.find((p) => name(p).length > 2 && text.toLowerCase().includes(name(p).toLowerCase()));
  const itRef = /\b(it|this|this note|current note)\b/i.test(text) && openId;

  const pickNote = (multi: boolean) => {
    if (!always && (named || itRef)) return;
    const opts = matches(text, pages);
    if (!opts.length) return;
    opts.forEach((p) => (ids[name(p)] = p.id));
    qs.push({ id: "note", header: multi ? "Notes" : "Note", question: multi ? "Which notes?" : "Which note?", multi, options: opts.map((p, i) => ({ label: name(p), recommended: i === 0 && (!multi || !!named) })), otherPlaceholder: "Note title" });
  };

  if (intent === "create") {
    const topic = text.match(/\b(?:on|about|for)\s+(.+)$/i)?.[1]?.replace(/[.?!]+$/, "").trim() ?? "";
    const t = topic ? topic[0].toUpperCase() + topic.slice(1) : "";
    if (always || !/\b(titled|called|named)\b/i.test(text))
      qs.push({ id: "title", header: "Title", question: "Title?", options: t ? [{ label: t, recommended: true }, { label: `${t} notes` }] : [], otherPlaceholder: "Note title" });
    if (always || !/\b(in|under|inside)\b\s+(my\s+)?\S+\s*(folder)?/i.test(text.replace(/\b(?:on|about)\s+.+$/i, ""))) {
      const parents = pages.filter((p) => !p.parentId && pages.some((c) => c.parentId === p.id)).slice(0, 3);
      parents.forEach((p) => (ids[name(p)] = p.id));
      qs.push({ id: "folder", header: "Folder", question: "Which folder?", options: [{ label: "Top level", recommended: true }, ...parents.map((p) => ({ label: name(p) }))], otherPlaceholder: "Folder name" });
    }
    if (always || !/\b(short|brief|medium|long|detailed|in depth)\b/i.test(text))
      qs.push({ id: "length", header: "Length", question: "How long?", other: false, options: [{ label: "Short", description: "~5 bullets" }, { label: "Medium", description: "a few sections", recommended: true }, { label: "Long", description: "detailed, examples" }] });
    if (always || !/\b(bullet|prose|paragraph|q&a|questions|outline)\b/i.test(text))
      qs.push({ id: "style", header: "Style", question: "Which style?", other: false, options: [{ label: "Bullets", recommended: true, preview: "• Key idea\n• Key idea" }, { label: "Prose", preview: "Short paragraphs." }, { label: "Q&A", preview: "Q: …\nA: …" }] });
  } else if (intent === "delete") {
    if (always || !named) pickNote(true);
  } else if (intent === "read") {
    pickNote(false);
  } else {
    pickNote(false);
    if (always || !/\bto\s+\S/i.test(text)) qs.push({ id: "name", header: "New name", question: "Rename to?", options: [], otherPlaceholder: "New title" });
  }
  if (!qs.length) return null;
  const title = { create: "New note", delete: "Delete", rename: "Rename", read: "Read note" }[intent];
  return { intent, title, questions: qs.slice(0, 4), ids };
}

/** Answers as one line the agent copies into tool args. */
export function choicesLine(plan: AskPlan, a: AskAnswers) {
  const ref = (l: string) => (plan.ids[l] ? `${l} (id ${plan.ids[l]})` : l);
  const parts = plan.questions.flatMap((q) => {
    const v = a[q.id] ?? [];
    if (!v.length) return [];
    return [`${q.header.toLowerCase()}: ${q.id === "note" || q.id === "folder" ? v.map(ref).join(", ") : v.join(", ")}`];
  });
  return parts.length ? `User choices (use exactly): ${parts.join("; ")}.` : "";
}
