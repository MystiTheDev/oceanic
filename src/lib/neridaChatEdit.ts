import { useSyncExternalStore } from "react";

/* Nerida edits the open note from chat. The model answers with numbered-block changes; the
 * note shows them highlighted until the user accepts or rejects them. */

/** Typical "change my note" requests. */
export const isEditRequest = (t: string) =>
  /\b(edit|rewrite|reword|fix|improve|add|insert|append|expand|shorten|update|change|correct)\b[^.?!]*\b(note|paragraph|section|heading|this|it)\b/i.test(t);

export type NoteBlock = { id: string; text: string; type: string };
/** The open note's top-level blocks, filled synchronously by PageEditor. */
export const NOTE_BLOCKS = "oc-nerida-note-blocks";
export const noteBlocks = (): NoteBlock[] => {
  const d = { blocks: [] as NoteBlock[] };
  window.dispatchEvent(new CustomEvent(NOTE_BLOCKS, { detail: d }));
  return d.blocks;
};

/** "paragraph" requests number only real paragraphs, so "second paragraph" skips headings and lists. */
export const targetBlocks = (blocks: NoteBlock[], ask: string) =>
  /\bparagraphs?\b/i.test(ask) ? blocks.filter((b) => b.type === "paragraph" && b.text.trim()) : blocks;

/** True when the request doesn't say where to edit: Nerida asks instead of guessing. */
export const unclearTarget = (ask: string, blocks: NoteBlock[]) =>
  blocks.length > 1 &&
  !/\b(first|second|third|fourth|fifth|sixth|last|final|next|top|bottom|end|start|beginning|intro\w*|conclusion|all|every|whole|entire|note|title|heading|this|it|\d+)\b/i.test(ask);

export const ASK_WHICH = "Which part of the note should I change (for example \"the second paragraph\" or \"the whole note\"), and how?";

export const editPrompt = (blocks: NoteBlock[], ask: string) =>
  `My note, one numbered block per line:\n<notes>\n${blocks.map((b, i) => `[${i + 1}] ${b.text}`).join("\n")}\n</notes>\n\n` +
  `Request: ${ask}\n\nReply only with changes, each in this exact format and nothing else:\n` +
  `REPLACE <number>: <new text for that block>\nADD AFTER <number>: <new block text>\n(use ADD AFTER 0 to add at the top)`;

/** `id` is the block to replace or add after; none = add at the top. */
export type Proposal = { kind: "replace" | "add"; id?: string; text: string };
/** Model lines → proposals; numbers outside the list are dropped. */
export function parseEdits(reply: string, blocks: NoteBlock[]): Proposal[] {
  return [...reply.matchAll(/^\s*(REPLACE|ADD AFTER)\s+(\d+)\s*:\s*(.+)$/gim)].flatMap((m) => {
    const i = Number(m[2]);
    const kind = m[1].toUpperCase() === "REPLACE" ? "replace" : "add";
    if (i > blocks.length || (i === 0 && kind === "replace")) return [];
    return [{ kind, id: blocks[i - 1]?.id, text: m[3].trim() } as Proposal];
  });
}

/** Proposed changes go to PageEditor, which applies them highlighted and returns how many it applied. */
export const PROPOSE = "oc-nerida-propose";
export const proposeEdits = (p: Proposal[]): number => {
  const d = { proposals: p, applied: 0 };
  window.dispatchEvent(new CustomEvent(PROPOSE, { detail: d }));
  return d.applied;
};

/* Pending changes: PageEditor owns them and registers accept/reject; chat and note read them. */
export type Pending = { count: number; accept: (i?: number) => void; reject: (i?: number) => void };
let pending: Pending = { count: 0, accept: () => {}, reject: () => {} };
const subs = new Set<() => void>();
export const setPending = (p: Pending) => ((pending = p), subs.forEach((f) => f()));
export const usePending = () =>
  useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => pending);
