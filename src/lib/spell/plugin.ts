import { Plugin, PluginKey, TextSelection, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { addToDictionary, autocorrectFor, completionFor, ignoreWord, isKnown, noteWord, spellState, subscribeSpell as subscribe, suggestionsFor } from "./engine";

/**
 * Spelling for any ProseMirror editor (notes and Docs):
 * - wavy underline under unknown words (click → custom suggestion popup)
 * - autocorrect when a word is finished (Backspace right after undoes it)
 * - ghost-text completion, Tab to accept
 */
export const SPELL_POPUP = "oc-spell-popup";
export type SpellPopupDetail = { word: string; x: number; y: number; replace: (text: string) => void };

type PState = { decos: DecorationSet; ghost: { pos: number; text: string } | null };
const key = new PluginKey<PState>("oc-spell");
const WORD = /[A-Za-z][A-Za-z'’]*/g;

function scan(state: EditorState, skipCursorWord = false): DecorationSet {
  const s = spellState();
  if (!s.ready || !s.settings.underline) return DecorationSet.empty;
  const decos: Decoration[] = [];
  // Only the word being typed right now is left alone (a click inside a word keeps its underline).
  const cursor = skipCursorWord && state.selection.empty ? state.selection.from : -1;
  state.doc.descendants((node, pos) => {
    if (node.type.spec.code) return false;
    if (!node.isText || node.marks.some((m) => m.type.name === "code" || m.type.name === "link")) return;
    for (const m of node.text!.matchAll(WORD)) {
      const from = pos + m.index!, to = from + m[0].length;
      if (cursor >= from && cursor <= to) continue; // still being typed
      if (!isKnown(m[0].replace(/[’']+$/, ""))) decos.push(Decoration.inline(from, to, { class: "oc-misspell" }));
    }
  });
  return DecorationSet.create(state.doc, decos);
}

/** Word just before `pos` in its text block. */
function wordBefore(state: EditorState, pos: number) {
  const $p = state.doc.resolve(pos);
  const text = $p.parent.textBetween(0, $p.parentOffset, undefined, "￼");
  const m = /[A-Za-z][A-Za-z'’]*$/.exec(text);
  return m ? { word: m[0], from: pos - m[0].length, to: pos } : null;
}

export function spellPlugin() {
  let lastFix: { from: number; to: number; original: string } | null = null;
  return new Plugin<PState>({
    key,
    state: {
      init: (_, state) => ({ decos: scan(state), ghost: null }),
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(key) as Partial<PState> | "refresh" | undefined;
        const decos = tr.docChanged ? scan(state, true) : meta === "refresh" || tr.selectionSet ? scan(state) : prev.decos.map(tr.mapping, tr.doc);
        const ghost = meta && meta !== "refresh" && "ghost" in meta ? meta.ghost ?? null : tr.docChanged || tr.selectionSet ? null : prev.ghost;
        return { decos, ghost };
      },
    },
    props: {
      // Oceanic does its own spelling: switch the browser's off here.
      attributes: { spellcheck: "false" },
      decorations(state) {
        const s = key.getState(state)!;
        if (!s.ghost) return s.decos;
        const g = document.createElement("span");
        g.className = "oc-ghost";
        g.textContent = s.ghost.text;
        return s.decos.add(state.doc, [Decoration.widget(s.ghost.pos, g, { side: 1 })]);
      },
      handleTextInput(view, from, to, text) {
        if (!/^[\s.,!?;:)]$/.test(text)) return false;
        const w = wordBefore(view.state, from);
        if (!w) return false;
        noteWord(w.word);
        const fix = autocorrectFor(w.word);
        if (!fix || fix === w.word) return false;
        const tr = view.state.tr.insertText(fix + text, w.from, to);
        lastFix = { from: w.from, to: w.from + fix.length + text.length, original: w.word + text };
        view.dispatch(tr);
        return true;
      },
      handleKeyDown(view, e) {
        const st = key.getState(view.state)!;
        if (e.key === "Tab" && st.ghost && !e.shiftKey) {
          view.dispatch(view.state.tr.insertText(st.ghost.text, st.ghost.pos).setMeta(key, { ghost: null }));
          return true;
        }
        if (e.key === "Escape" && st.ghost) {
          view.dispatch(view.state.tr.setMeta(key, { ghost: null }));
          return true;
        }
        // Backspace right after an autocorrect puts back what you typed.
        if (e.key === "Backspace" && lastFix && view.state.selection.empty && view.state.selection.from === lastFix.to) {
          const f = lastFix;
          lastFix = null;
          view.dispatch(view.state.tr.insertText(f.original.slice(0, -1), f.from, f.to));
          return true;
        }
        if (e.key.length === 1 || e.key === "Enter") lastFix = null;
        return false;
      },
    },
    view(view: EditorView) {
      // Re-scan when the word list finishes loading or your dictionary changes.
      const unsub = subscribe(() => setTimeout(() => !view.isDestroyed && view.dispatch(view.state.tr.setMeta(key, "refresh"))));
      return {
        update(v, prev) {
          // While typing, offer a completion when the cursor ends a word.
          if (v.state.doc.eq(prev.doc)) return;
          const sel = v.state.selection;
          const after = sel.empty ? v.state.doc.textBetween(sel.from, Math.min(sel.from + 1, sel.$from.end())) : "x";
          const w = sel.empty && !/[A-Za-z]/.test(after) ? wordBefore(v.state, sel.from) : null;
          const full = w ? completionFor(w.word) : null;
          const ghost = full && w ? { pos: sel.from, text: full.slice(w.word.length) } : null;
          if (ghost) setTimeout(() => !v.isDestroyed && v.state.selection.from === ghost.pos && v.dispatch(v.state.tr.setMeta(key, { ghost })));
        },
        destroy: unsub,
      };
    },
  });
}


/** Right-click on an underlined word: its fixes + dictionary actions (empty if not misspelled). */
export function spellMenuItems(view: EditorView, e: { target: EventTarget | null; clientX: number; clientY: number }) {
  if (!(e.target as HTMLElement | null)?.closest?.(".oc-misspell")) return [];
  const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
  if (!at) return [];
  const $p = view.state.doc.resolve(at.pos);
  const text = $p.parent.textContent;
  const off = $p.parentOffset;
  let a = off, b = off;
  while (a > 0 && /[A-Za-z'’]/.test(text[a - 1])) a--;
  while (b < text.length && /[A-Za-z'’]/.test(text[b])) b++;
  const word = text.slice(a, b);
  if (!word) return [];
  const from = at.pos - (off - a), to = at.pos + (b - off);
  const replace = (t: string) => {
    const tr = view.state.tr.insertText(t, from, to);
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + t.length)));
    view.focus();
  };
  const sugg = suggestionsFor(word);
  return [
    ...(sugg.length ? sugg.map((s) => ({ label: s, onSelect: () => replace(s) })) : [{ label: "No suggestions", disabled: true }]),
    { label: "Add to my dictionary", onSelect: () => addToDictionary(word) },
    { label: "Ignore", onSelect: () => ignoreWord(word) },
    "divider" as const,
  ];
}
