/**
 * Phone editing (Notion-style): a scrollable toolbar above the keyboard, a
 * bottom-sheet block list for "+" and a typed "/", a "Turn into" sheet (Aa),
 * and a small popup for selected text.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bold, ChevronDown, Code, Heading1, Heading2, Heading3, Highlighter, IndentDecrease, IndentIncrease, Italic,
  Link, List, ListChecks, ListOrdered, ListTree, Plus, Quote, Redo2, Strikethrough, Text, Underline, Undo2,
} from "lucide-react";
import { useBlockNoteEditor, type DefaultReactSuggestionItem, type SuggestionMenuProps } from "@blocknote/react";
import type { BlockNoteEditor } from "@blocknote/core";
import "./mobile-editor.css";
import { buzz } from "./mobilePrefs";

type Editor = BlockNoteEditor<any, any, any>;


const suggestions = (editor: Editor) =>
  editor.getExtension("suggestionMenu") as { openSuggestionMenu: (c: string) => void; closeMenu: () => void } | undefined;

/** "+": start a fresh line when the current one has text, then open the block list. */
function addBlock(editor: Editor) {
  const block = editor.getTextCursorPosition().block;
  if ((block.content as unknown[] | undefined)?.length) {
    const [created] = editor.insertBlocks([{ type: "paragraph" }], block, "after");
    editor.setTextCursorPosition(created, "end");
  }
  suggestions(editor)?.openSuggestionMenu("/");
}

/** Bottom sheet that replaces the "/" dropdown: one row per block, with its description. */
export function MobileBlockSheet({ items, onItemClick }: SuggestionMenuProps<DefaultReactSuggestionItem>) {
  const editor = useBlockNoteEditor();
  return createPortal(
    <div className="ocme-sheet-bg" onPointerDown={(e) => e.target === e.currentTarget && suggestions(editor as Editor)?.closeMenu()}>
      <div className="ocme-sheet" onPointerDown={(e) => e.preventDefault() /* keep the keyboard and caret */}>
        <div className="ocme-grab" />
        <h2>Add a block</h2>
        {items.length ? (
          items.map((item) => (
            <button key={item.title} className="ocme-block" onClick={() => (buzz(), onItemClick?.(item))}>
              <span className="ocme-block-icon">{item.icon}</span>
              <span>
                <strong>{item.title}</strong>
                {item.subtext && <em>{item.subtext}</em>}
              </span>
            </button>
          ))
        ) : (
          <p className="ocme-empty">No blocks match. Keep typing or delete the "/".</p>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Block types "Turn into" can switch the current block to. */
const TURN_INTO = [
  { label: "Text", note: "Plain paragraph", icon: <Text size={20} />, type: "paragraph" },
  { label: "Heading 1", note: "Big section heading", icon: <Heading1 size={20} />, type: "heading", props: { level: 1 } },
  { label: "Heading 2", note: "Medium section heading", icon: <Heading2 size={20} />, type: "heading", props: { level: 2 } },
  { label: "Heading 3", note: "Small section heading", icon: <Heading3 size={20} />, type: "heading", props: { level: 3 } },
  { label: "Bulleted list", note: "Simple bullet points", icon: <List size={20} />, type: "bulletListItem" },
  { label: "Numbered list", note: "Numbered steps", icon: <ListOrdered size={20} />, type: "numberedListItem" },
  { label: "To-do", note: "Checkbox to tick off", icon: <ListChecks size={20} />, type: "checkListItem" },
  { label: "Toggle list", note: "Hide details under a toggle", icon: <ListTree size={20} />, type: "toggleListItem" },
  { label: "Quote", note: "Set a quote apart", icon: <Quote size={20} />, type: "quote" },
  { label: "Code", note: "Code with monospace font", icon: <Code size={20} />, type: "codeBlock" },
] as const;

function TurnIntoSheet({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  return createPortal(
    <div className="ocme-sheet-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ocme-sheet" onPointerDown={(e) => e.preventDefault()}>
        <div className="ocme-grab" />
        <h2>Turn into</h2>
        {TURN_INTO.map((t) => (
          <button
            key={t.label}
            className="ocme-block"
            onClick={() => {
              buzz();
              const block = editor.getTextCursorPosition().block;
              editor.updateBlock(block, { type: t.type, props: "props" in t ? t.props : {} } as never);
              onClose();
            }}
          >
            <span className="ocme-block-icon">{t.icon}</span>
            <span>
              <strong>{t.label}</strong>
              <em>{t.note}</em>
            </span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Toolbar button handlers: finger-down keeps focus (and the keyboard) in the note;
 * the action runs on release, so a sheet it opens can't catch the same tap.
 */
const press = (fn: () => void) => ({
  onPointerDown: (e: React.PointerEvent) => e.preventDefault(),
  onClick: () => {
    buzz();
    fn();
  },
});

function askLink(editor: Editor) {
  const url = window.prompt("Link address", "https://");
  if (url && url !== "https://") editor.createLink(url);
}

/** Toolbar pinned above the keyboard while the note is being edited. */
export function MobileToolbar({ editor }: { editor: Editor }) {
  const [editing, setEditing] = useState(false);
  const [turnInto, setTurnInto] = useState(false);

  useEffect(() => {
    const root = editor.domElement;
    if (!root) return;
    const on = () => setEditing(true);
    // Focus moving to our own toolbar or sheets is still "editing".
    const off = (e: FocusEvent) => !(e.relatedTarget as Element | null)?.closest(".ocme-bar, .ocme-sheet") && setEditing(false);
    root.addEventListener("focusin", on);
    root.addEventListener("focusout", off);
    return () => {
      root.removeEventListener("focusin", on);
      root.removeEventListener("focusout", off);
    };
  }, [editor]);

  // Keep the caret above the keyboard + toolbar while typing.
  useEffect(() => {
    if (!editing) return;
    const keep = () => {
      const sel = window.getSelection();
      if (!sel?.rangeCount) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const limit = (window.visualViewport?.height ?? window.innerHeight) - 72;
      if (rect.bottom > limit) (editor.domElement?.closest(".overflow-y-auto") ?? document.scrollingElement)?.scrollBy({ top: rect.bottom - limit + 24, behavior: "smooth" });
    };
    const offSel = editor.onSelectionChange(keep);
    window.visualViewport?.addEventListener("resize", keep);
    return () => {
      offSel?.();
      window.visualViewport?.removeEventListener("resize", keep);
    };
  }, [editing, editor]);

  if (!editing && !turnInto) return null;
  const tap = (fn: () => void) => press(fn);
  const style = (s: Record<string, unknown>) => () => editor.toggleStyles(s as never);
  const block = editor.getTextCursorPosition().block;

  return (
    <>
      <div className="ocme-bar" role="toolbar" aria-label="Formatting">
        <button aria-label="Add block" className="ocme-accent" {...tap(() => addBlock(editor))}>
          <Plus size={20} />
        </button>
        <button aria-label="Turn into" className="ocme-aa" {...tap(() => setTurnInto(true))}>
          Aa
        </button>
        <span className="ocme-sep" />
        <button aria-label="Bold" {...tap(style({ bold: true }))}><Bold size={19} /></button>
        <button aria-label="Italic" {...tap(style({ italic: true }))}><Italic size={19} /></button>
        <button aria-label="Underline" {...tap(style({ underline: true }))}><Underline size={19} /></button>
        <button aria-label="Strikethrough" {...tap(style({ strike: true }))}><Strikethrough size={19} /></button>
        <button aria-label="Highlight" {...tap(style({ backgroundColor: "yellow" }))}><Highlighter size={19} /></button>
        <button aria-label="Link" {...tap(() => askLink(editor))}><Link size={19} /></button>
        <span className="ocme-sep" />
        <button aria-label="Indent" disabled={!editor.canNestBlock()} {...tap(() => editor.nestBlock())}><IndentIncrease size={19} /></button>
        <button aria-label="Outdent" disabled={!editor.canUnnestBlock()} {...tap(() => editor.unnestBlock())}><IndentDecrease size={19} /></button>
        <span className="ocme-sep" />
        <button aria-label="Undo" {...tap(() => editor.undo())}><Undo2 size={19} /></button>
        <button aria-label="Redo" {...tap(() => editor.redo())}><Redo2 size={19} /></button>
        <button aria-label="Hide keyboard" {...tap(() => (document.activeElement as HTMLElement | null)?.blur())}><ChevronDown size={20} /></button>
      </div>
      {turnInto && block && <TurnIntoSheet editor={editor} onClose={() => setTurnInto(false)} />}
    </>
  );
}

/** Small popup over selected text: bold, italic, highlight, link. */
export function MobileSelectionPopup() {
  const editor = useBlockNoteEditor() as Editor;
  // BlockNote also shows its toolbar after a plain tap; only show this for real selections.
  const [hasText, setHasText] = useState(() => !!editor.getSelectedText());
  // Placed just above the selected text (BlockNote's own placement landed on the toolbar).
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(
    () =>
      editor.onSelectionChange(() => {
        const text = !!editor.getSelectedText();
        setHasText(text);
        const sel = window.getSelection();
        if (!text || !sel?.rangeCount) return setAt(null);
        const r = sel.getRangeAt(0).getBoundingClientRect();
        const half = 86; // half the popup's width
        setAt({ x: Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8), y: Math.max(r.top - 52, 8) });
      }),
    [editor],
  );
  const tap = (fn: () => void) => press(fn);
  if (!hasText || !at) return null;
  return createPortal(
    <div className="ocme-pop" style={{ left: at.x, top: at.y }}>
      <button aria-label="Bold" {...tap(() => editor.toggleStyles({ bold: true } as never))}><Bold size={18} /></button>
      <button aria-label="Italic" {...tap(() => editor.toggleStyles({ italic: true } as never))}><Italic size={18} /></button>
      <button aria-label="Highlight" {...tap(() => editor.toggleStyles({ backgroundColor: "yellow" } as never))}><Highlighter size={18} /></button>
      <button aria-label="Link" {...tap(() => askLink(editor))}><Link size={18} /></button>
    </div>,
    document.body,
  );
}
