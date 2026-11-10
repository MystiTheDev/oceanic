import { useEffect, useState, type ReactNode } from "react";
import { Extension, type Editor } from "@tiptap/core";
import { ListTree, MessageSquareText, PenLine, RotateCcw, Square, Wand2, X } from "lucide-react";
import { BetaPill, NeridaMark } from "../components/NeridaOrb";
import { Markdown } from "../components/NeridaPanel";
import { openNeridaOutline } from "../components/NeridaOutlineUI";
import { mdToHtml, openNeridaEdit, runFeedback, stopEdit } from "../lib/neridaEdit";

/* Nerida in Docs: edit selection, continue writing, outline, essay feedback.
 * Opened from the Nerida ribbon tab, or by typing /continue or /outline + Enter. */

const caret = (editor: Editor) => {
  const c = editor.view.coordsAtPos(editor.state.selection.to);
  return { x: c.left, y: c.bottom + 8 };
};

export function editSelection(editor: Editor) {
  const { from, to } = editor.state.selection;
  const text = editor.state.doc.textBetween(from, to, "\n").trim();
  if (!text) return false;
  openNeridaEdit({
    text,
    ...caret(editor),
    replace: (t) => editor.chain().focus().insertContentAt({ from, to }, mdToHtml(t).replace(/^<p>(.*)<\/p>$/s, "$1")).run(),
    insertBelow: (t) => editor.chain().focus().setTextSelection(to).insertContentAt(editor.state.selection.$to.after(), mdToHtml(t)).run(),
  });
  return true;
}

export function continueWriting(editor: Editor) {
  const at = editor.state.selection.to;
  const before = editor.state.doc.textBetween(0, at, "\n\n").trim();
  if (!before) return false;
  openNeridaEdit({
    text: before,
    ...caret(editor),
    continue: true,
    // A new paragraph after the caret's block.
    replace: (t) => editor.chain().focus().insertContentAt(editor.state.doc.resolve(Math.min(at, editor.state.doc.content.size)).after(1), mdToHtml(t)).run(),
  });
  return true;
}

export function outline(editor: Editor, title: string) {
  const at = editor.state.selection.to;
  openNeridaOutline({
    topic: /^untitled/i.test(title) ? "" : title,
    insert: (md) => {
      const $p = editor.state.doc.resolve(Math.min(at, editor.state.doc.content.size));
      const empty = $p.parent.textContent.trim() === "";
      const range = empty && $p.depth >= 1 ? { from: $p.before(1), to: $p.after(1) } : $p.depth >= 1 ? $p.after(1) : at;
      editor.chain().focus().insertContentAt(range, mdToHtml(md)).run();
    },
  });
}

/** "/continue" or "/outline" alone on a line + Enter. */
export const NeridaSlash = (getTitle: () => string, onMissing: (msg: string) => void) =>
  Extension.create({
    name: "neridaSlash",
    addKeyboardShortcuts() {
      return {
        Enter: ({ editor }) => {
          const $f = editor.state.selection.$from;
          const cmd = $f.parent.textContent.trim().toLowerCase();
          if (cmd !== "/continue" && cmd !== "/outline") return false;
          editor.chain().deleteRange({ from: $f.start(), to: $f.end() }).run();
          if (cmd === "/outline") outline(editor as Editor, getTitle());
          else if (!continueWriting(editor as Editor)) onMissing("Write something first, then Nerida can continue it.");
          return true;
        },
      };
    },
  });

/** Ribbon group (Nerida tab). */
export function NeridaGroup({ editor, title, onFeedback, Big }: { editor: Editor; title: string; onFeedback: () => void; Big: (p: { icon: ReactNode; label: string; onClick: () => void }) => ReactNode }) {
  const [hint, setHint] = useState("");
  const flash = (m: string) => (setHint(m), setTimeout(() => setHint(""), 2500));
  return (
    <>
      {Big({ icon: <Wand2 />, label: "Edit selection", onClick: () => editSelection(editor) || flash("Select some text first.") })}
      {Big({ icon: <PenLine />, label: "Continue writing", onClick: () => continueWriting(editor) || flash("Write something first.") })}
      {Big({ icon: <ListTree />, label: "Outline", onClick: () => outline(editor, title) })}
      {Big({ icon: <MessageSquareText />, label: "Feedback", onClick: onFeedback })}
      <span className="self-center px-2 text-[12px] text-neutral-400">{hint || "Tip: type /continue or /outline and press Enter"}</span>
    </>
  );
}

/** Essay feedback drawer (right side of the doc). */
export function FeedbackDrawer({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async () => {
    const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n\n").trim();
    if (text.split(/\s+/).length < 30) return setErr("Write at least a paragraph (about 30 words) for feedback.");
    setBusy(true);
    setErr("");
    setOut("");
    try {
      setOut(await runFeedback(text, setOut));
    } catch (e) {
      setErr(String(e).replace(/^Error: /, ""));
    }
    setBusy(false);
  };
  useEffect(() => void run(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="absolute inset-y-0 right-0 z-40 flex w-[340px] max-w-full flex-col border-l border-white/[0.08] bg-[var(--oc-surface)] shadow-[-12px_0_30px_rgba(0,0,0,0.35)]">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2.5">
        <NeridaMark size={16} busy={busy} />
        <span className="flex-1 text-[13px] font-medium text-neutral-100">Essay feedback<BetaPill /></span>
        {busy ? (
          <button type="button" title="Stop" onClick={stopEdit} className="cursor-pointer rounded p-1 text-neutral-400 hover:bg-white/[0.08]"><Square className="size-3.5 shrink-0" fill="currentColor" strokeWidth={0} /></button>
        ) : (
          <button type="button" title="Check again" onClick={() => void run()} className="cursor-pointer rounded p-1 text-neutral-400 hover:bg-white/[0.08]"><RotateCcw className="size-3.5" /></button>
        )}
        <button type="button" onClick={() => (busy && stopEdit(), onClose())} className="cursor-pointer rounded p-1 text-neutral-400 hover:bg-white/[0.08]"><X className="size-4" /></button>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto px-4 py-3 text-[13px]">
        {err ? <p className="text-red-300">{err}</p> : out ? <Markdown text={out} /> : <p className="oc-nerida-shimmer text-neutral-400">Reading your essay…</p>}
      </div>
    </div>
  );
}
